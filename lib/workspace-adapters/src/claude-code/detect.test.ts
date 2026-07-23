import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { assertGoldenCase, listGoldenCases } from "../golden.js";
import type { RepoContext } from "../types.js";
import {
  claudeCodeAdapter,
  defaultManagedSettingsPaths,
  detect,
  type ClaudeCodeArtifact,
} from "./index.js";

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures");

/**
 * Per-case detector options stored in `<case>/options.json` (sibling of
 * `input-repo/`, so it is never part of the scanned tree). Relative paths
 * resolve against the case directory.
 */
interface CaseOptions {
  userScope?: boolean;
  homeDir?: string;
  managedSettingsPaths?: string[];
}

function contextFor(caseDir: string, inputRepoDir: string): RepoContext {
  const optionsPath = join(caseDir, "options.json");
  const options: CaseOptions = existsSync(optionsPath)
    ? (JSON.parse(readFileSync(optionsPath, "utf8")) as CaseOptions)
    : {};
  return {
    rootDir: inputRepoDir,
    userScope: options.userScope ?? false,
    homeDir: options.homeDir === undefined ? undefined : join(caseDir, options.homeDir),
    // Fixtures must never fall through to the machine's real probe locations.
    managedSettingsPaths: (options.managedSettingsPaths ?? []).map((p) =>
      join(caseDir, p),
    ),
  };
}

function serialize(artifacts: readonly ClaudeCodeArtifact[]): string {
  return `${JSON.stringify(artifacts, null, 2)}\n`;
}

describe("claude-code golden fixtures", () => {
  const goldenCases = listGoldenCases(fixturesRoot).filter(
    (c) => c.adapter === "claude-code",
  );

  it("ships at least 3 cases including the negative one (T1.1 AC)", () => {
    expect(goldenCases.length).toBeGreaterThanOrEqual(3);
    expect(goldenCases.map((c) => c.name)).toContain("no-artifacts");
  });

  it("declares its fixtures on the adapter, matching the on-disk cases", () => {
    expect(claudeCodeAdapter.fixtures.map((f) => f.name)).toEqual(
      goldenCases.map((c) => c.name),
    );
  });

  for (const goldenCase of listGoldenCases(fixturesRoot).filter(
    (c) => c.adapter === "claude-code",
  )) {
    it(`matches ${goldenCase.name} byte-exactly`, async () => {
      await assertGoldenCase(goldenCase, (inputRepoDir) => [
        {
          path: "detected.json",
          content: serialize(detect(contextFor(goldenCase.dir, inputRepoDir))),
        },
      ]);
    });
  }
});

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

/** Creates a temp repo from `files` and returns a probe-free context for it. */
function makeRepo(files: Record<string, string>): { root: string; repo: RepoContext } {
  const root = mkdtempSync(join(tmpdir(), "gitmesh-claude-detect-"));
  tempDirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, repo: { rootDir: root, managedSettingsPaths: [] } };
}

/**
 * File symlinks need Developer Mode or admin rights on Windows; directory
 * links are created as junctions, which work unprivileged. Probe once and
 * skip symlink tests where the platform cannot create them.
 */
const symlinkSupport = (() => {
  const dir = mkdtempSync(join(tmpdir(), "gitmesh-symlink-probe-"));
  let file = false;
  let directory = false;
  try {
    writeFileSync(join(dir, "target.txt"), "x");
    try {
      symlinkSync("target.txt", join(dir, "file-link"));
      file = true;
    } catch {
      /* unsupported */
    }
    mkdirSync(join(dir, "target-dir"));
    try {
      symlinkSync(join(dir, "target-dir"), join(dir, "dir-link"), "junction");
      directory = true;
    } catch {
      /* unsupported */
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { file, directory };
})();

/** Creates a directory symlink portably (junction on Windows, symlink elsewhere). */
function symlinkDir(target: string, linkPath: string): void {
  symlinkSync(target, linkPath, "junction");
}

describe("claude-code detect()", () => {
  it("is deterministic: two runs return identical, sorted inventories", () => {
    const { repo } = makeRepo({
      "CLAUDE.md": "root\n",
      "b/CLAUDE.md": "b\n",
      "a/CLAUDE.md": "a\n",
      ".claude/rules/z.md": "z\n",
      ".claude/rules/a.md": "a\n",
      ".mcp.json": "{}\n",
    });
    const first = detect(repo);
    const second = detect(repo);
    expect(second).toEqual(first);
    const paths = first.map((a) => a.path);
    expect(paths).toEqual([...paths].sort());
  });

  it("ignores nested .claude directories, node_modules, and .git", () => {
    const { repo } = makeRepo({
      "CLAUDE.md": "root\n",
      "sub/.claude/settings.json": "{}\n",
      "sub/.claude/rules/hidden.md": "x\n",
      "node_modules/dep/CLAUDE.md": "x\n",
      ".git/CLAUDE.md": "x\n",
    });
    expect(detect(repo)).toEqual([
      { path: "CLAUDE.md", kind: "instructions", scope: "project" },
    ]);
  });

  it("reports user-scope memory only when userScope is set", () => {
    const home = mkdtempSync(join(tmpdir(), "gitmesh-claude-home-"));
    tempDirs.push(home);
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "CLAUDE.md"), "# personal\n");
    const { root } = makeRepo({ "CLAUDE.md": "repo\n" });

    const without = detect({ rootDir: root, homeDir: home, managedSettingsPaths: [] });
    expect(without.map((a) => a.path)).toEqual(["CLAUDE.md"]);

    const withUser = detect({
      rootDir: root,
      userScope: true,
      homeDir: home,
      managedSettingsPaths: [],
    });
    expect(withUser).toContainEqual({
      path: "~/.claude/CLAUDE.md",
      kind: "instructions",
      scope: "user",
    });
  });

  it("probes managed settings by presence only, reporting basenames", () => {
    const managed = mkdtempSync(join(tmpdir(), "gitmesh-claude-managed-"));
    tempDirs.push(managed);
    writeFileSync(join(managed, "managed-settings.json"), "{}\n");
    mkdirSync(join(managed, "managed-settings.d"));
    writeFileSync(join(managed, "managed-settings.d", "00.json"), "{}\n");
    const { root } = makeRepo({});

    const artifacts = detect({
      rootDir: root,
      managedSettingsPaths: [
        join(managed, "managed-settings.json"),
        join(managed, "managed-settings.d"),
        join(managed, "does-not-exist.json"),
      ],
    });
    expect(artifacts).toEqual([
      { path: "managed-settings.d", kind: "settings", scope: "managed" },
      { path: "managed-settings.json", kind: "settings", scope: "managed" },
    ]);
  });

  it("computes per-OS default managed-settings probe locations", () => {
    expect(defaultManagedSettingsPaths("darwin")).toEqual([
      "/Library/Application Support/ClaudeCode/managed-settings.json",
      "/Library/Application Support/ClaudeCode/managed-settings.d",
    ]);
    expect(defaultManagedSettingsPaths("linux")).toEqual([
      "/etc/claude-code/managed-settings.json",
      "/etc/claude-code/managed-settings.d",
    ]);
    expect(defaultManagedSettingsPaths("win32", { ProgramData: "C:\\ProgramData" })).toEqual([
      "C:\\ProgramData\\ClaudeCode\\managed-settings.json",
      "C:\\ProgramData\\ClaudeCode\\managed-settings.d",
    ]);
  });

  it.skipIf(!symlinkSupport.file)(
    "inventories a symlinked CLAUDE.md with its literal target",
    () => {
      const { root, repo } = makeRepo({ "AGENTS.md": "shared\n" });
      symlinkSync("AGENTS.md", join(root, "CLAUDE.md"));
      expect(detect(repo)).toEqual([
        {
          path: "CLAUDE.md",
          kind: "instructions",
          scope: "project",
          symlinkTarget: "AGENTS.md",
        },
      ]);
    },
  );

  it.skipIf(!symlinkSupport.file)("flags a dangling symlink as broken", () => {
    const { root, repo } = makeRepo({});
    symlinkSync("missing.md", join(root, "CLAUDE.md"));
    expect(detect(repo)).toEqual([
      {
        path: "CLAUDE.md",
        kind: "instructions",
        scope: "project",
        symlinkTarget: "missing.md",
        broken: true,
      },
    ]);
  });

  it.skipIf(!symlinkSupport.directory)(
    "follows a symlinked .claude/skills directory",
    () => {
      const { root, repo } = makeRepo({
        "shared/skills/deploy/SKILL.md": "---\nname: deploy\n---\n",
      });
      mkdirSync(join(root, ".claude"), { recursive: true });
      symlinkDir(join(root, "shared", "skills"), join(root, ".claude", "skills"));
      expect(detect(repo)).toEqual([
        { path: ".claude/skills/deploy/SKILL.md", kind: "skill", scope: "project" },
      ]);
    },
  );

  it.skipIf(!symlinkSupport.directory)(
    "terminates on directory symlink cycles without duplicates",
    () => {
      const { root, repo } = makeRepo({ "CLAUDE.md": "root\n", "sub/keep.txt": "x\n" });
      symlinkDir(root, join(root, "sub", "loop"));
      expect(detect(repo)).toEqual([
        { path: "CLAUDE.md", kind: "instructions", scope: "project" },
      ]);
    },
  );
});

describe("claudeCodeAdapter contract", () => {
  it("identifies itself and implements detect only", () => {
    expect(claudeCodeAdapter.name).toBe("claude-code");
    expect(claudeCodeAdapter.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(() => claudeCodeAdapter.importArtifacts({ rootDir: "." })).toThrow(
      /not implemented/,
    );
    expect(() => claudeCodeAdapter.capabilities()).toThrow(/not implemented/);
    expect(() => claudeCodeAdapter.plan({})).toThrow(/not implemented/);
    expect(() => claudeCodeAdapter.emit({})).toThrow(/not implemented/);
  });
});

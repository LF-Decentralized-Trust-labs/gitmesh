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
  codexAdapter,
  defaultRequirementsTomlPaths,
  detect,
  type CodexArtifact,
} from "./index.js";

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures");

/**
 * Per-case options in `<case>/options.json` (sibling of `input-repo/`).
 * Relative paths resolve against the case directory; `codexHome` becomes the
 * `CODEX_HOME` environment value. Defaults isolate fixtures from the real
 * environment and probe locations.
 */
interface CaseOptions {
  userScope?: boolean;
  homeDir?: string;
  codexHome?: string;
  requirementsTomlPaths?: string[];
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
    env:
      options.codexHome === undefined
        ? {}
        : { CODEX_HOME: join(caseDir, options.codexHome) },
    requirementsTomlPaths: (options.requirementsTomlPaths ?? []).map((p) =>
      join(caseDir, p),
    ),
  };
}

function serialize(artifacts: readonly CodexArtifact[]): string {
  return `${JSON.stringify(artifacts, null, 2)}\n`;
}

describe("codex golden fixtures", () => {
  const goldenCases = listGoldenCases(fixturesRoot).filter((c) => c.adapter === "codex");

  it("ships at least 3 cases including the negative one (T1.2 AC)", () => {
    expect(goldenCases.length).toBeGreaterThanOrEqual(3);
    expect(goldenCases.map((c) => c.name)).toContain("no-artifacts");
    expect(codexAdapter.fixtures.map((f) => f.name)).toEqual(
      goldenCases.map((c) => c.name),
    );
  });

  for (const goldenCase of listGoldenCases(fixturesRoot).filter(
    (c) => c.adapter === "codex",
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
  const root = mkdtempSync(join(tmpdir(), "gitmesh-codex-detect-"));
  tempDirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, repo: { rootDir: root, env: {}, requirementsTomlPaths: [] } };
}

/** File symlinks need Developer Mode/admin on Windows; probe and skip if absent. */
const fileSymlinkSupport = (() => {
  const dir = mkdtempSync(join(tmpdir(), "gitmesh-symlink-probe-"));
  try {
    writeFileSync(join(dir, "target.txt"), "x");
    symlinkSync("target.txt", join(dir, "file-link"));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

describe("codex detect()", () => {
  it("reports a CODEX_HOME hint when set — presence only, never the value", () => {
    const { root } = makeRepo({});
    const artifacts = detect({
      rootDir: root,
      env: { CODEX_HOME: "/somewhere/machine-specific" },
      requirementsTomlPaths: [],
    });
    expect(artifacts).toEqual([{ path: "CODEX_HOME", kind: "env-hint", scope: "user" }]);
    expect(JSON.stringify(artifacts)).not.toContain("machine-specific");
  });

  it("computes per-OS default requirements.toml probe locations", () => {
    expect(defaultRequirementsTomlPaths("linux", {}, "/home/u")).toEqual([
      "/home/u/.codex/requirements.toml",
      "/etc/codex/requirements.toml",
    ]);
    expect(
      defaultRequirementsTomlPaths("darwin", { CODEX_HOME: "/srv/codex" }, "/Users/u"),
    ).toEqual(["/srv/codex/requirements.toml"]);
    expect(defaultRequirementsTomlPaths("win32", {}, "C:\\Users\\u")).toEqual([
      "C:\\Users\\u\\.codex\\requirements.toml",
    ]);
  });

  it.skipIf(!fileSymlinkSupport)(
    "inventories a symlinked AGENTS.md with its literal target",
    () => {
      const { root, repo } = makeRepo({ "CLAUDE.md": "shared\n" });
      symlinkSync("CLAUDE.md", join(root, "AGENTS.md"), "file");
      expect(detect(repo)).toEqual([
        {
          path: "AGENTS.md",
          kind: "instructions",
          scope: "project",
          symlinkTarget: "CLAUDE.md",
        },
      ]);
    },
  );

  it.skipIf(!fileSymlinkSupport)("flags a dangling symlink as broken", () => {
    const { root, repo } = makeRepo({});
    symlinkSync("missing.md", join(root, "AGENTS.md"), "file");
    expect(detect(repo)).toEqual([
      {
        path: "AGENTS.md",
        kind: "instructions",
        scope: "project",
        symlinkTarget: "missing.md",
        broken: true,
      },
    ]);
  });

  it("terminates on directory symlink cycles without duplicates", () => {
    const { root, repo } = makeRepo({ "AGENTS.md": "root\n", "sub/keep.txt": "x\n" });
    symlinkSync(root, join(root, "sub", "loop"), "junction");
    expect(detect(repo)).toEqual([
      { path: "AGENTS.md", kind: "instructions", scope: "project" },
    ]);
  });
});

describe("codexAdapter contract", () => {
  it("identifies itself and implements detect only", () => {
    expect(codexAdapter.name).toBe("codex");
    expect(() => codexAdapter.importArtifacts({ rootDir: "." })).toThrow(
      /not implemented/,
    );
    expect(() => codexAdapter.capabilities()).toThrow(/not implemented/);
    expect(() => codexAdapter.plan({})).toThrow(/not implemented/);
    expect(() => codexAdapter.emit({})).toThrow(/not implemented/);
  });
});

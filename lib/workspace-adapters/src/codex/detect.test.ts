import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeDetectorGoldens,
  loadCaseOptions,
  symlinkSupport,
  useTempDirs,
} from "../detect-test-utils.js";
import type { RepoContext } from "../types.js";
import { codexAdapter, defaultRequirementsTomlPaths, detect } from "./index.js";

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

describeDetectorGoldens(codexAdapter, "T1.2", (caseDir, inputRepoDir) => {
  const options = loadCaseOptions<CaseOptions>(caseDir);
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
});

const temp = useTempDirs();

/** Creates a temp repo from `files` and returns a probe-free context for it. */
function makeRepo(files: Record<string, string>): { root: string; repo: RepoContext } {
  const root = temp.makeRepo("gitmesh-codex-detect-", files);
  return { root, repo: { rootDir: root, env: {}, requirementsTomlPaths: [] } };
}

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

  it.skipIf(!symlinkSupport.file)(
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

  it.skipIf(!symlinkSupport.file)("flags a dangling symlink as broken", () => {
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

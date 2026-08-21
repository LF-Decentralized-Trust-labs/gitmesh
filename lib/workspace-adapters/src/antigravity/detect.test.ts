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
import { antigravityAdapter, defaultAntigravitySettingsPaths, detect } from "./index.js";

/**
 * Per-case options in `<case>/options.json` (sibling of `input-repo/`).
 * Relative paths resolve against the case directory. The default - an empty
 * probe list - isolates fixtures from the real environment.
 */
interface CaseOptions {
  antigravitySettingsPaths?: string[];
}

describeDetectorGoldens(antigravityAdapter, "T1.5", (caseDir, inputRepoDir) => {
  const options = loadCaseOptions<CaseOptions>(caseDir);
  return {
    rootDir: inputRepoDir,
    antigravitySettingsPaths: (options.antigravitySettingsPaths ?? []).map((p) =>
      join(caseDir, p),
    ),
  };
});

const temp = useTempDirs();

/** Creates a temp repo from `files` and returns a probe-free context for it. */
function makeRepo(files: Record<string, string>): { root: string; repo: RepoContext } {
  const root = temp.makeRepo("gitmesh-antigravity-detect-", files);
  return { root, repo: { rootDir: root, antigravitySettingsPaths: [] } };
}

describe("antigravity detect()", () => {
  it("defaults the settings probe to the antigravity-cli location", () => {
    expect(defaultAntigravitySettingsPaths("/home/u")).toEqual([
      join("/home/u", ".gemini", "antigravity-cli", "settings.json"),
    ]);
  });

  it("reports the settings probe once - presence only, never location or content", () => {
    const { root } = makeRepo({
      "elsewhere/settings.json": '{"deniedCommands":["rm -rf /"]}\n',
      "elsewhere/other.json": "{}\n",
    });
    const artifacts = detect({
      rootDir: root,
      antigravitySettingsPaths: [
        join(root, "elsewhere", "settings.json"),
        join(root, "elsewhere", "other.json"),
        join(root, "elsewhere", "missing.json"),
      ],
    });
    expect(artifacts).toEqual([
      { path: "antigravity-cli/settings.json", kind: "settings", scope: "managed" },
    ]);
    expect(JSON.stringify(artifacts)).not.toContain("rm -rf");
  });

  it("classifies plugin-bundle files by shape, wherever the bundle root sits", () => {
    const { repo } = makeRepo({
      ".gemini/anywhere/plugin.json": "{}\n",
      ".gemini/anywhere/hooks.json": "{}\n",
      ".gemini/anywhere/mcp_config.json": "{}\n",
      ".gemini/anywhere/skills/a/SKILL.md": "# A\n",
      ".gemini/anywhere/skills/a/helper.md": "resource\n",
      ".gemini/anywhere/agents/deep/nested.md": "# N\n",
      ".gemini/anywhere/rules/base.md": "# B\n",
      ".gemini/anywhere/README.md": "not an artifact\n",
    });
    expect(detect(repo).map((artifact) => [artifact.path, artifact.kind])).toEqual([
      [".gemini/anywhere/agents/deep/nested.md", "agent"],
      [".gemini/anywhere/hooks.json", "hooks"],
      [".gemini/anywhere/mcp_config.json", "mcp-config"],
      [".gemini/anywhere/plugin.json", "plugin-manifest"],
      [".gemini/anywhere/rules/base.md", "rule"],
      [".gemini/anywhere/skills/a/SKILL.md", "skill"],
    ]);
  });

  it("never mistakes .gemini/settings.json for a plugin file", () => {
    const { repo } = makeRepo({ ".gemini/settings.json": "{}\n" });
    expect(detect(repo)).toEqual([
      { path: ".gemini/settings.json", kind: "settings", scope: "project" },
    ]);
  });

  it("ignores GEMINI.md under the config directories", () => {
    const { repo } = makeRepo({
      "GEMINI.md": "root\n",
      "docs/GEMINI.md": "nested\n",
      ".gemini/GEMINI.md": "config dir\n",
      ".agent/GEMINI.md": "config dir\n",
      "node_modules/dep/GEMINI.md": "dependency\n",
    });
    expect(detect(repo).map((artifact) => artifact.path)).toEqual([
      "GEMINI.md",
      "docs/GEMINI.md",
    ]);
  });

  it.skipIf(!symlinkSupport.file)(
    "inventories a symlinked GEMINI.md with its literal target",
    () => {
      const { root, repo } = makeRepo({ "AGENTS.md": "shared\n" });
      symlinkSync("AGENTS.md", join(root, "GEMINI.md"), "file");
      expect(detect(repo)).toEqual([
        {
          path: "GEMINI.md",
          kind: "instructions",
          scope: "project",
          symlinkTarget: "AGENTS.md",
        },
      ]);
    },
  );

  it.skipIf(!symlinkSupport.file)("flags a dangling symlink as broken", () => {
    const { root, repo } = makeRepo({ ".gemini/keep.txt": "x\n" });
    symlinkSync("missing.json", join(root, ".gemini", "settings.json"), "file");
    expect(detect(repo)).toEqual([
      {
        path: ".gemini/settings.json",
        kind: "settings",
        scope: "project",
        symlinkTarget: "missing.json",
        broken: true,
      },
    ]);
  });

  it("terminates on directory symlink cycles without duplicates", () => {
    const { root, repo } = makeRepo({ "GEMINI.md": "root\n", "sub/keep.txt": "x\n" });
    symlinkSync(root, join(root, "sub", "loop"), "junction");
    expect(detect(repo)).toEqual([
      { path: "GEMINI.md", kind: "instructions", scope: "project" },
    ]);
  });
});

describe("antigravityAdapter contract", () => {
  it("identifies itself and implements detect only", () => {
    expect(antigravityAdapter.name).toBe("antigravity");
    expect(() => antigravityAdapter.importArtifacts({ rootDir: "." })).toThrow(
      /not implemented/,
    );
    expect(() => antigravityAdapter.capabilities()).toThrow(/not implemented/);
    expect(() => antigravityAdapter.plan({})).toThrow(/not implemented/);
    expect(() => antigravityAdapter.emit({})).toThrow(/not implemented/);
  });
});

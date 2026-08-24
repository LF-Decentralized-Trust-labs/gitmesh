import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeDetectorGoldens,
  symlinkSupport,
  useTempDirs,
} from "../detect-test-utils.js";
import { detect, openCodeAdapter } from "./index.js";

describeDetectorGoldens(openCodeAdapter, "T1.6", (_caseDir, inputRepoDir) => ({
  rootDir: inputRepoDir,
}));

const temp = useTempDirs();

describe("opencode detect()", () => {
  it("finds opencode.json{,c} and AGENTS.md at any depth in one walk", () => {
    const root = temp.makeRepo("gitmesh-opencode-detect-", {
      "opencode.json": "{}\n",
      "packages/app/opencode.jsonc": "{}\n",
      "packages/app/AGENTS.md": "nested\n",
      "node_modules/dep/opencode.json": "{}\n",
    });
    expect(detect({ rootDir: root })).toEqual([
      { path: "opencode.json", kind: "config", scope: "project" },
      { path: "packages/app/AGENTS.md", kind: "instructions", scope: "project" },
      { path: "packages/app/opencode.jsonc", kind: "config", scope: "project" },
    ]);
  });

  it("accepts both singular and plural .opencode resource directories", () => {
    const root = temp.makeRepo("gitmesh-opencode-detect-", {
      ".opencode/command/review.md": "# review\n",
      ".opencode/commands/ship/deep.md": "# ship\n",
      ".opencode/agent/planner.md": "# planner\n",
      ".opencode/mode/build.md": "# legacy mode\n",
      ".opencode/mode/nested/ignored.md": "single-level only\n",
      ".opencode/skill/lint/SKILL.md": "# lint\n",
      ".opencode/skill/lint/reference.md": "resource, not manifest\n",
      ".opencode/plugin/notify.ts": "export {}\n",
      ".opencode/plugin/readme.md": "not a plugin\n",
      ".opencode/themes/dark.json": "{}\n",
    });
    expect(detect({ rootDir: root }).map((a) => [a.path, a.kind])).toEqual([
      [".opencode/agent/planner.md", "agent"],
      [".opencode/command/review.md", "command"],
      [".opencode/commands/ship/deep.md", "command"],
      [".opencode/mode/build.md", "mode"],
      [".opencode/plugin/notify.ts", "plugin"],
      [".opencode/skill/lint/SKILL.md", "skill"],
      [".opencode/themes/dark.json", "theme"],
    ]);
  });

  it("inventories .opencode/opencode.json without walking .opencode for instructions", () => {
    const root = temp.makeRepo("gitmesh-opencode-detect-", {
      ".opencode/opencode.json": "{}\n",
      ".opencode/AGENTS.md": "config dir, not instructions\n",
    });
    expect(detect({ rootDir: root })).toEqual([
      { path: ".opencode/opencode.json", kind: "config", scope: "project" },
    ]);
  });

  it.skipIf(!symlinkSupport.file)("flags a dangling config symlink as broken", () => {
    const root = temp.makeRepo("gitmesh-opencode-detect-", { "keep.txt": "x\n" });
    symlinkSync("missing.json", join(root, "opencode.json"), "file");
    expect(detect({ rootDir: root })).toEqual([
      {
        path: "opencode.json",
        kind: "config",
        scope: "project",
        symlinkTarget: "missing.json",
        broken: true,
      },
    ]);
  });
});

describe("openCodeAdapter contract", () => {
  it("identifies itself and implements detect only", () => {
    expect(openCodeAdapter.name).toBe("opencode");
    expect(() => openCodeAdapter.importArtifacts({ rootDir: "." })).toThrow(
      /not implemented/,
    );
    expect(() => openCodeAdapter.capabilities()).toThrow(/not implemented/);
    expect(() => openCodeAdapter.plan({})).toThrow(/not implemented/);
    expect(() => openCodeAdapter.emit({})).toThrow(/not implemented/);
  });
});

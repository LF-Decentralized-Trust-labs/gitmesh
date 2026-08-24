import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeDetectorGoldens,
  symlinkSupport,
  useTempDirs,
} from "../detect-test-utils.js";
import { clineAdapter, detect } from "./index.js";

describeDetectorGoldens(clineAdapter, "T1.6", (_caseDir, inputRepoDir) => ({
  rootDir: inputRepoDir,
}));

const temp = useTempDirs();

describe("cline detect()", () => {
  it("classifies the .clinerules directory: rules, workflows, and hooks", () => {
    const root = temp.makeRepo("gitmesh-cline-detect-", {
      ".clinerules/01-coding.md": "# coding\n",
      ".clinerules/notes.txt": "plain-text rule\n",
      ".clinerules/diagram.png": "not a rule\n",
      ".clinerules/workflows/pr-review.md": "# pr review\n",
      ".clinerules/workflows/helper.sh": "not a workflow\n",
      ".clinerules/workflows/archive/old.md": "nested - the surface is flat\n",
      ".clinerules/hooks/PreToolUse": "#!/bin/sh\n",
      ".clinerules/hooks/lib/common.sh": "nested helper, not a hook\n",
    });
    expect(detect({ rootDir: root }).map((a) => [a.path, a.kind])).toEqual([
      [".clinerules/01-coding.md", "rule"],
      [".clinerules/hooks/PreToolUse", "hooks"],
      [".clinerules/notes.txt", "rule"],
      [".clinerules/workflows/pr-review.md", "workflow"],
    ]);
  });

  it("inventories the legacy single-file .clinerules and the fallback rule files", () => {
    const root = temp.makeRepo("gitmesh-cline-detect-", {
      ".clinerules": "legacy rules\n",
      ".cursorrules": "cursor fallback\n",
      ".windsurfrules": "windsurf fallback\n",
      ".clineignore": "dist/\n",
      "AGENTS.md": "root instructions\n",
      "packages/app/AGENTS.md": "nested - Cline documents root only\n",
    });
    expect(detect({ rootDir: root })).toEqual([
      { path: ".clineignore", kind: "ignore", scope: "project" },
      { path: ".clinerules", kind: "rule", scope: "project" },
      { path: ".cursorrules", kind: "rule", scope: "project" },
      { path: ".windsurfrules", kind: "rule", scope: "project" },
      { path: "AGENTS.md", kind: "instructions", scope: "project" },
    ]);
  });

  it.skipIf(!symlinkSupport.directory)(
    "walks a .clinerules symlinked to a directory instead of flagging it broken",
    () => {
      const root = temp.makeRepo("gitmesh-cline-detect-", {
        "shared/rules/base.md": "# shared\n",
      });
      symlinkSync(join(root, "shared", "rules"), join(root, ".clinerules"), "junction");
      expect(detect({ rootDir: root })).toEqual([
        { path: ".clinerules/base.md", kind: "rule", scope: "project" },
      ]);
    },
  );
});

describe("clineAdapter contract", () => {
  it("identifies itself and implements detect only", () => {
    expect(clineAdapter.name).toBe("cline");
    expect(() => clineAdapter.importArtifacts({ rootDir: "." })).toThrow(
      /not implemented/,
    );
    expect(() => clineAdapter.capabilities()).toThrow(/not implemented/);
    expect(() => clineAdapter.plan({})).toThrow(/not implemented/);
    expect(() => clineAdapter.emit({})).toThrow(/not implemented/);
  });
});

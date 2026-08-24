import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeDetectorGoldens,
  symlinkSupport,
  useTempDirs,
} from "../detect-test-utils.js";
import { agentsMdAdapter, detect } from "./index.js";

describeDetectorGoldens(agentsMdAdapter, "T1.6", (_caseDir, inputRepoDir) => ({
  rootDir: inputRepoDir,
}));

const temp = useTempDirs();

describe("agentsmd detect()", () => {
  it("inventories AGENTS.md at any depth, skipping .git and node_modules", () => {
    const root = temp.makeRepo("gitmesh-agentsmd-detect-", {
      "AGENTS.md": "root\n",
      "packages/app/AGENTS.md": "nested\n",
      "node_modules/dep/AGENTS.md": "dependency\n",
      ".git/AGENTS.md": "git dir\n",
      "CLAUDE.md": "not the standard file\n",
    });
    expect(detect({ rootDir: root })).toEqual([
      { path: "AGENTS.md", kind: "instructions", scope: "project" },
      { path: "packages/app/AGENTS.md", kind: "instructions", scope: "project" },
    ]);
  });

  it.skipIf(!symlinkSupport.file)(
    "inventories a symlinked AGENTS.md with its literal target",
    () => {
      const root = temp.makeRepo("gitmesh-agentsmd-detect-", {
        "docs/instructions.md": "shared\n",
      });
      symlinkSync("docs/instructions.md", join(root, "AGENTS.md"), "file");
      expect(detect({ rootDir: root })).toEqual([
        {
          path: "AGENTS.md",
          kind: "instructions",
          scope: "project",
          symlinkTarget: "docs/instructions.md",
        },
      ]);
    },
  );
});

describe("agentsMdAdapter contract", () => {
  it("identifies itself and implements detect only", () => {
    expect(agentsMdAdapter.name).toBe("agentsmd");
    expect(() => agentsMdAdapter.importArtifacts({ rootDir: "." })).toThrow(
      /not implemented/,
    );
    expect(() => agentsMdAdapter.capabilities()).toThrow(/not implemented/);
    expect(() => agentsMdAdapter.plan({})).toThrow(/not implemented/);
    expect(() => agentsMdAdapter.emit({})).toThrow(/not implemented/);
  });
});

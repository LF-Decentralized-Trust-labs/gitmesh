import { describe, expect, it } from "vitest";
import { describeDetectorGoldens, useTempDirs } from "../detect-test-utils.js";
import { detect, devinAdapter } from "./index.js";

describeDetectorGoldens(devinAdapter, "T1.6", (_caseDir, inputRepoDir) => ({
  rootDir: inputRepoDir,
}));

const temp = useTempDirs();

describe("devin detect()", () => {
  it("reads both the preferred .devin and the legacy .windsurf locations", () => {
    const root = temp.makeRepo("gitmesh-devin-detect-", {
      ".devin/rules/style.md": "# style\n",
      ".windsurf/rules/legacy.md": "# legacy\n",
      ".windsurfrules": "single-file legacy rules\n",
      ".windsurf/workflows/deploy.md": "# deploy\n",
      ".windsurf/hooks.json": "{}\n",
      ".devin/skills/lint/SKILL.md": "# lint\n",
      ".windsurf/skills/ship/SKILL.md": "# ship\n",
      ".devin/blueprint.yaml": "vm: default\n",
    });
    expect(detect({ rootDir: root }).map((a) => [a.path, a.kind])).toEqual([
      [".devin/blueprint.yaml", "config"],
      [".devin/rules/style.md", "rule"],
      [".devin/skills/lint/SKILL.md", "skill"],
      [".windsurf/hooks.json", "hooks"],
      [".windsurf/rules/legacy.md", "rule"],
      [".windsurf/skills/ship/SKILL.md", "skill"],
      [".windsurf/workflows/deploy.md", "workflow"],
      [".windsurfrules", "rule"],
    ]);
  });

  it("ignores AGENTS.md under the config directories", () => {
    const root = temp.makeRepo("gitmesh-devin-detect-", {
      "AGENTS.md": "root\n",
      "services/api/AGENTS.md": "nested\n",
      ".devin/AGENTS.md": "config dir\n",
      ".windsurf/AGENTS.md": "config dir\n",
      "node_modules/dep/AGENTS.md": "dependency\n",
    });
    expect(detect({ rootDir: root }).map((a) => a.path)).toEqual([
      "AGENTS.md",
      "services/api/AGENTS.md",
    ]);
  });
});

describe("devinAdapter contract", () => {
  it("identifies itself and implements detect only", () => {
    expect(devinAdapter.name).toBe("devin");
    expect(() => devinAdapter.importArtifacts({ rootDir: "." })).toThrow(
      /not implemented/,
    );
    expect(() => devinAdapter.capabilities()).toThrow(/not implemented/);
    expect(() => devinAdapter.plan({})).toThrow(/not implemented/);
    expect(() => devinAdapter.emit({})).toThrow(/not implemented/);
  });
});

import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeDetectorGoldens,
  symlinkSupport,
  useTempDirs,
} from "../detect-test-utils.js";
import {
  COEXISTENCE_NOTE,
  detect,
  thirdPartyManagersAdapter,
} from "./index.js";

describeDetectorGoldens(thirdPartyManagersAdapter, "T1.7", (_caseDir, inputRepoDir) => ({
  rootDir: inputRepoDir,
}));

const temp = useTempDirs();

function makeRepo(files: Record<string, string>): string {
  return temp.makeRepo("gitmesh-managers-detect-", files);
}

describe("third-party-managers detect()", () => {
  it("labels every artifact with its manager", () => {
    const root = makeRepo({
      ".agents/agents.json": "{}\n",
      ".agents/local.json": '{"secret":"REDACTED-FIXTURE"}\n',
      ".agentsync-state.json": "{}\n",
      ".ai/agent_sync.yaml": "tools: []\n",
      "skills-lock.json": '{"version":1,"skills":{}}\n',
      ".mcp.lock": '{"lockfileVersion":1}\n',
    });
    expect(detect({ rootDir: root }).map((a) => [a.path, a.kind, a.scope, a.manager])).toEqual([
      [".agents/agents.json", "source", "project", "agents-json"],
      [".agents/local.json", "config", "local", "agents-json"],
      [".agentsync-state.json", "state", "project", "agentsync"],
      [".ai/agent_sync.yaml", "config", "project", "agent_sync"],
      [".mcp.lock", "lockfile", "project", "mcp-lock"],
      ["skills-lock.json", "lockfile", "project", "skills-lock"],
    ]);
  });

  it("inventories the ruler and rulesync source trees recursively", () => {
    const root = makeRepo({
      ".ruler/ruler.toml": "[gitignore]\n",
      ".ruler/AGENTS.md": "# Rules\n",
      ".ruler/style/frontend.md": "# Frontend\n",
      ".ruler/mcp.json": "{}\n",
      ".ruler/notes.txt": "not a source file\n",
      "rulesync.jsonc": "{}\n",
      ".rulesync/rules/overview.md": "---\nroot: true\n---\n",
      ".rulesync/skills/lint/SKILL.md": "# Lint\n",
      ".rulesync/mcp.jsonc": "{}\n",
      ".rulesync/rules/mcp.json": "nested lookalike, not the feature file\n",
    });
    expect(detect({ rootDir: root }).map((a) => [a.path, a.kind, a.manager])).toEqual([
      [".ruler/AGENTS.md", "source", "ruler"],
      [".ruler/mcp.json", "config", "ruler"],
      [".ruler/ruler.toml", "config", "ruler"],
      [".ruler/style/frontend.md", "source", "ruler"],
      [".rulesync/mcp.jsonc", "config", "rulesync"],
      [".rulesync/rules/overview.md", "source", "rulesync"],
      [".rulesync/skills/lint/SKILL.md", "source", "rulesync"],
      ["rulesync.jsonc", "config", "rulesync"],
    ]);
  });

  it("reports nothing on a repo with only first-party agent config", () => {
    const root = makeRepo({
      "AGENTS.md": "# Rules\n",
      "CLAUDE.md": "# Claude\n",
      ".claude/settings.json": "{}\n",
      ".cursor/rules/general.mdc": "---\n---\n",
    });
    expect(detect({ rootDir: root })).toEqual([]);
  });

  it.skipIf(!symlinkSupport.file)(
    "maps root-file symlink topology with literal targets",
    () => {
      const root = makeRepo({ "AGENTS.md": "# Shared\n" });
      symlinkSync("AGENTS.md", join(root, "CLAUDE.md"));
      symlinkSync("AGENTS.md", join(root, "GEMINI.md"));
      symlinkSync("missing.md", join(root, ".cursorrules"));
      expect(detect({ rootDir: root })).toEqual([
        {
          path: ".cursorrules",
          kind: "symlink",
          scope: "project",
          symlinkTarget: "missing.md",
          broken: true,
          manager: "symlinks",
        },
        {
          path: "CLAUDE.md",
          kind: "symlink",
          scope: "project",
          symlinkTarget: "AGENTS.md",
          manager: "symlinks",
        },
        {
          path: "GEMINI.md",
          kind: "symlink",
          scope: "project",
          symlinkTarget: "AGENTS.md",
          manager: "symlinks",
        },
      ]);
    },
  );

  it.skipIf(!symlinkSupport.directory)(
    "treats a symlink resolving to a directory as healthy, without walking it",
    () => {
      const root = makeRepo({
        ".agents/skills/lint/SKILL.md": "# Lint\n",
        ".claude/settings.json": "{}\n",
      });
      symlinkSync(
        join(root, ".agents", "skills"),
        join(root, ".claude", "skills"),
        "junction",
      );
      expect(detect({ rootDir: root })).toEqual([
        {
          path: ".claude/skills",
          kind: "symlink",
          scope: "project",
          symlinkTarget: join(root, ".agents", "skills").replaceAll("\\", "/"),
          manager: "symlinks",
        },
      ]);
    },
  );

  it.skipIf(!symlinkSupport.file)(
    "does not report a symlinked manager file a second time as topology",
    () => {
      const root = makeRepo({ "config/agents.json": "{}\n", ".agents/keep.txt": "x\n" });
      symlinkSync("../config/agents.json", join(root, ".agents", "agents.json"));
      expect(detect({ rootDir: root })).toEqual([
        {
          path: ".agents/agents.json",
          kind: "source",
          scope: "project",
          symlinkTarget: "../config/agents.json",
          manager: "agents-json",
        },
      ]);
    },
  );
});

describe("thirdPartyManagersAdapter contract", () => {
  it("implements detect, declares no capabilities, and stubs the rest", () => {
    expect(thirdPartyManagersAdapter.name).toBe("third-party-managers");
    expect(thirdPartyManagersAdapter.capabilities()).toEqual({});
    expect(() => thirdPartyManagersAdapter.importArtifacts({ rootDir: "." })).toThrow(
      /detect-and-respect/,
    );
    expect(() => thirdPartyManagersAdapter.plan({})).toThrow(/not implemented/);
    expect(() => thirdPartyManagersAdapter.emit({})).toThrow(/not implemented/);
  });

  it("exports an informational coexistence note that proposes nothing destructive", () => {
    expect(COEXISTENCE_NOTE).toContain("ADR-004");
    expect(COEXISTENCE_NOTE).toContain("respects");
    for (const destructive of ["delete", "remove", "overwrite", "replace"]) {
      expect(COEXISTENCE_NOTE.toLowerCase()).not.toContain(destructive);
    }
  });
});

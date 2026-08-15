import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeDetectorGoldens,
  symlinkSupport,
  useTempDirs,
} from "../detect-test-utils.js";
import type { RepoContext } from "../types.js";
import { copilotAdapter, detect, extractFrontmatter } from "./index.js";

describeDetectorGoldens(copilotAdapter, "T1.4", (_caseDir, inputRepoDir) => {
  return { rootDir: inputRepoDir };
});

const temp = useTempDirs();

function makeRepo(files: Record<string, string>): { root: string; repo: RepoContext } {
  const root = temp.makeRepo("gitmesh-copilot-detect-", files);
  return { root, repo: { rootDir: root } };
}

describe("copilot detect()", () => {
  it("is deterministic: two runs return identical, sorted inventories", () => {
    const { repo } = makeRepo({
      "AGENTS.md": "root\n",
      "b/AGENTS.md": "b\n",
      "a/AGENTS.md": "a\n",
      ".github/instructions/z.instructions.md": "---\napplyTo: z\n---\nz\n",
      ".github/instructions/a.instructions.md": "---\napplyTo: a\n---\na\n",
      ".vscode/mcp.json": "{}\n",
    });
    const first = detect(repo);
    const second = detect(repo);
    expect(second).toEqual(first);
    const paths = first.map((a) => a.path);
    expect(paths).toEqual([...paths].sort());
  });

  it("ignores node_modules and .git during AGENTS.md walk", () => {
    const { repo } = makeRepo({
      "AGENTS.md": "root\n",
      "node_modules/dep/AGENTS.md": "x\n",
      ".git/AGENTS.md": "x\n",
    });
    expect(detect(repo)).toEqual([
      { path: "AGENTS.md", kind: "instructions", scope: "project" },
    ]);
  });

  it("detects AGENTS.md inside .github/", () => {
    const { repo } = makeRepo({
      ".github/AGENTS.md": "copilot reads this\n",
    });
    expect(detect(repo)).toEqual([
      { path: ".github/AGENTS.md", kind: "instructions", scope: "project" },
    ]);
  });

  it("classifies AGENTS.md under .github/agents/ as an agent, not instructions", () => {
    const { repo } = makeRepo({
      ".github/agents/AGENTS.md": "# Agent\n",
      ".github/agents/nested/AGENTS.md": "# Nested agent\n",
    });
    expect(detect(repo)).toEqual([
      { path: ".github/agents/AGENTS.md", kind: "agent", scope: "project" },
      { path: ".github/agents/nested/AGENTS.md", kind: "agent", scope: "project" },
    ]);
  });

  it("searches .github/instructions/ recursively", () => {
    const { repo } = makeRepo({
      ".github/instructions/nested/deep.instructions.md": "---\napplyTo: deep\n---\n",
      ".github/instructions/notes.md": "not an instructions file\n",
    });
    expect(detect(repo)).toEqual([
      {
        path: ".github/instructions/nested/deep.instructions.md",
        kind: "rule",
        scope: "project",
        frontmatter: { applyTo: "deep" },
      },
    ]);
  });

  it("ignores .instructions.md files outside .github/instructions/", () => {
    const { repo } = makeRepo({
      "docs/style.instructions.md": "---\napplyTo: nope\n---\n",
    });
    expect(detect(repo)).toEqual([]);
  });

  it("detects all copilot config artifacts", () => {
    const { repo } = makeRepo({
      ".github/copilot-instructions.md": "root\n",
      ".vscode/mcp.json": "{}\n",
      ".github/agents/review.md": "# Review\n",
      ".vscode/settings.json": '{ "chat.tools.global.autoApprove": true }\n',
      ".github/instructions/test.instructions.md": "---\napplyTo: test\n---\ncontent\n",
    });
    const artifacts = detect(repo);
    const kinds = artifacts.map((a) => a.kind);
    expect(kinds).toContain("mcp-config");
    expect(kinds).toContain("agent");
    expect(kinds).toContain("settings");
    expect(kinds).toContain("rule");
    expect(kinds).toContain("instructions");
  });

  it("does NOT emit settings artifact when no auto-approve key is present", () => {
    const { repo } = makeRepo({
      ".vscode/settings.json": '{ "editor.tabSize": 2 }\n',
    });
    expect(detect(repo)).toEqual([]);
  });

  it("names every auto-approve key that is set, and no settings value", () => {
    const { repo } = makeRepo({
      ".vscode/settings.json": JSON.stringify({
        "chat.tools.urls.autoApprove": true,
        "chat.tools.terminal.autoApprove": { rm: true },
        "github.copilot.advanced": { secret: "s3cret" },
      }),
    });
    expect(detect(repo)).toEqual([
      {
        path: ".vscode/settings.json",
        kind: "settings",
        scope: "project",
        autoApprove: [
          "chat.tools.terminal.autoApprove",
          "chat.tools.urls.autoApprove",
        ],
      },
    ]);
  });

  it("emits a settings artifact for a single key, even when it is false", () => {
    const { repo } = makeRepo({
      ".vscode/settings.json": '{ "chat.tools.terminal.autoApprove": false }\n',
    });
    expect(detect(repo)).toEqual([
      {
        path: ".vscode/settings.json",
        kind: "settings",
        scope: "project",
        autoApprove: ["chat.tools.terminal.autoApprove"],
      },
    ]);
  });

  it("reads JSONC settings: comments and a trailing comma", () => {
    const { repo } = makeRepo({
      ".vscode/settings.json": [
        "{",
        "  // let it run",
        '  "chat.tools.global.autoApprove": true, /* block */',
        '  "editor.rulers": [80, 100,],',
        "}",
        "",
      ].join("\n"),
    });
    expect(detect(repo)).toEqual([
      {
        path: ".vscode/settings.json",
        kind: "settings",
        scope: "project",
        autoApprove: ["chat.tools.global.autoApprove"],
      },
    ]);
  });

  it("does not mistake comment markers or commas inside string values for syntax", () => {
    const { repo } = makeRepo({
      ".vscode/settings.json": JSON.stringify({
        "chat.tools.global.autoApprove": true,
        "http.proxy": "http://example.com/*",
        "files.exclude": "a,}",
      }),
    });
    expect(detect(repo)).toEqual([
      {
        path: ".vscode/settings.json",
        kind: "settings",
        scope: "project",
        autoApprove: ["chat.tools.global.autoApprove"],
      },
    ]);
  });

  it("survives a settings.json that is not a JSON object", () => {
    for (const content of ["null", "42", '"hello"', "[1, 2]", "not json at all"]) {
      const { repo } = makeRepo({ ".vscode/settings.json": content });
      expect(detect(repo)).toEqual([]);
    }
  });

  it.skipIf(!symlinkSupport.file)(
    "inventories a symlinked AGENTS.md with its literal target",
    () => {
      const { root, repo } = makeRepo({ "CLAUDE.md": "shared\n" });
      symlinkSync("CLAUDE.md", join(root, "AGENTS.md"));
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

  it.skipIf(!symlinkSupport.file)(
    "reports a dangling settings.json symlink on presence alone",
    () => {
      // A file in `.vscode/` so the directory exists to link into.
      const { root, repo } = makeRepo({ ".vscode/keep.txt": "x\n" });
      symlinkSync("missing.json", join(root, ".vscode/settings.json"));
      expect(detect(repo)).toEqual([
        {
          path: ".vscode/settings.json",
          kind: "settings",
          scope: "project",
          symlinkTarget: "missing.json",
          broken: true,
        },
      ]);
    },
  );

  it.skipIf(!symlinkSupport.file)("flags a dangling symlink as broken", () => {
    const { root, repo } = makeRepo({});
    symlinkSync("missing.md", join(root, "AGENTS.md"));
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
});

describe("extractFrontmatter", () => {
  it("parses single string applyTo", () => {
    const content = '---\napplyTo: "**/*.ts"\n---\nbody\n';
    expect(extractFrontmatter(content)).toEqual({
      applyTo: "**/*.ts",
    });
  });

  it("parses inline array applyTo", () => {
    const content = '---\napplyTo: ["**/*.ts", "**/*.tsx"]\n---\nbody\n';
    expect(extractFrontmatter(content)).toEqual({
      applyTo: ["**/*.ts", "**/*.tsx"],
    });
  });

  it("parses inline array with brace glob containing comma (quote-aware split)", () => {
    const content = '---\napplyTo: ["**/{ts,tsx}"]\n---\nbody\n';
    expect(extractFrontmatter(content)).toEqual({
      applyTo: ["**/{ts,tsx}"],
    });
  });

  it("parses empty inline array applyTo: []", () => {
    const content = "---\napplyTo: []\n---\nbody\n";
    expect(extractFrontmatter(content)).toEqual({
      applyTo: [],
    });
  });

  it("parses multiline array applyTo", () => {
    const content = '---\napplyTo:\n  - "**/*.ts"\n  - "**/*.tsx"\n---\nbody\n';
    expect(extractFrontmatter(content)).toEqual({
      applyTo: ["**/*.ts", "**/*.tsx"],
    });
  });

  it("strips trailing YAML comment from scalar value", () => {
    const content = '---\napplyTo: "**/*.ts" # apply to TypeScript\n---\nbody\n';
    expect(extractFrontmatter(content)).toEqual({
      applyTo: "**/*.ts",
    });
  });

  it("does not strip # inside a quoted value", () => {
    const content = '---\napplyTo: "**/#test*.ts"\n---\nbody\n';
    expect(extractFrontmatter(content)).toEqual({
      applyTo: "**/#test*.ts",
    });
  });

  it("ignores indented keys (not column-0)", () => {
    // An indented `applyTo:` inside a nested mapping must NOT be parsed.
    const content = "---\nscope:\n  applyTo: nested\n---\nbody\n";
    expect(extractFrontmatter(content)).toEqual({});
  });

  it("returns undefined when no frontmatter present", () => {
    const content = "No frontmatter here.\nJust body.\n";
    expect(extractFrontmatter(content)).toBeUndefined();
  });

  it("returns empty object if applyTo not present", () => {
    const content = "---\ndescription: test\n---\nbody\n";
    expect(extractFrontmatter(content)).toEqual({});
  });
});

describe("copilotAdapter contract", () => {
  it("identifies itself and implements detect only", () => {
    expect(copilotAdapter.name).toBe("copilot");
    expect(copilotAdapter.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(() => copilotAdapter.importArtifacts({ rootDir: "." })).toThrow(/not implemented/);
    expect(() => copilotAdapter.capabilities()).toThrow(/not implemented/);
    expect(() => copilotAdapter.plan({})).toThrow(/not implemented/);
    expect(() => copilotAdapter.emit({})).toThrow(/not implemented/);
  });
});

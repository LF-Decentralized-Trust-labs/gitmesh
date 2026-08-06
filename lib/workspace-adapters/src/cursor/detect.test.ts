import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeDetectorGoldens,
  symlinkSupport,
  useTempDirs,
} from "../detect-test-utils.js";
import type { RepoContext } from "../types.js";
import { cursorAdapter, detect, extractFrontmatter } from "./index.js";

describeDetectorGoldens(cursorAdapter, "T1.3", (_caseDir, inputRepoDir) => {
  return { rootDir: inputRepoDir };
});

const temp = useTempDirs();

/** Creates a temp repo from `files` and returns a context for it. */
function makeRepo(files: Record<string, string>): { root: string; repo: RepoContext } {
  const root = temp.makeRepo("gitmesh-cursor-detect-", files);
  return { root, repo: { rootDir: root } };
}

describe("cursor detect()", () => {
  it("is deterministic: two runs return identical, sorted inventories", () => {
    const { repo } = makeRepo({
      "AGENTS.md": "root\n",
      "b/AGENTS.md": "b\n",
      "a/AGENTS.md": "a\n",
      ".cursor/rules/z.mdc": "---\nalwaysApply: true\n---\nz\n",
      ".cursor/rules/a.mdc": "---\nalwaysApply: false\n---\na\n",
      ".cursor/mcp.json": "{}\n",
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

  it("detects legacy .cursorrules at root", () => {
    const { repo } = makeRepo({
      ".cursorrules": "legacy rules\n",
    });
    expect(detect(repo)).toEqual([
      { path: ".cursorrules", kind: "instructions", scope: "project" },
    ]);
  });

  it("detects all .cursor/ config artifacts", () => {
    const { repo } = makeRepo({
      ".cursor/mcp.json": "{}\n",
      ".cursor/agents/review.md": "# Review\n",
      ".cursor/hooks.json": "{}\n",
      ".cursor/rules/test.mdc": "---\ndescription: test\n---\ncontent\n",
    });
    const artifacts = detect(repo);
    const kinds = artifacts.map((a) => a.kind);
    expect(kinds).toContain("mcp-config");
    expect(kinds).toContain("agent");
    expect(kinds).toContain("hooks");
    expect(kinds).toContain("rule");
  });

  it("detects nested .cursor/rules in subdirectories (Cursor v0.50+)", () => {
    const { repo } = makeRepo({
      ".cursor/rules/root.mdc": "---\ndescription: root\n---\nroot\n",
      "packages/app/.cursor/rules/db.mdc": "---\ndescription: db\n---\ndb\n",
    });
    expect(detect(repo).map((a) => a.path)).toEqual([
      ".cursor/rules/root.mdc",
      "packages/app/.cursor/rules/db.mdc",
    ]);
  });

  it("keeps non-rule artifacts root-only and AGENTS.md out of .cursor dirs", () => {
    const { repo } = makeRepo({
      "packages/app/.cursor/mcp.json": "{}\n",
      "packages/app/.cursor/hooks.json": "{}\n",
      "packages/app/.cursor/agents/helper.md": "# Helper\n",
      ".cursor/AGENTS.md": "config housekeeping, not instructions\n",
    });
    expect(detect(repo)).toEqual([]);
  });

  it("ignores non-.mdc files in .cursor/rules/", () => {
    const { repo } = makeRepo({
      ".cursor/rules/style.mdc": "---\ndescription: style\n---\nstyle\n",
      ".cursor/rules/NOTES.txt": "not a rule\n",
      ".cursor/rules/README.md": "not a rule\n",
    });
    const artifacts = detect(repo);
    expect(artifacts).toEqual([
      {
        path: ".cursor/rules/style.mdc",
        kind: "rule",
        scope: "project",
        frontmatter: { description: "style" },
      },
    ]);
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

  it.skipIf(!symlinkSupport.file)(
    "inventories a symlinked .mdc rule with its literal target",
    () => {
      const { root, repo } = makeRepo({
        "shared-rules/style.mdc": "---\ndescription: shared\n---\ncontent\n",
      });
      // Create .cursor/rules/ and symlink the .mdc file
      const rulesDir = join(root, ".cursor", "rules");
      mkdirSync(rulesDir, { recursive: true });
      symlinkSync(
        join(root, "shared-rules", "style.mdc"),
        join(rulesDir, "style.mdc"),
      );
      const artifacts = detect(repo);
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]!.path).toBe(".cursor/rules/style.mdc");
      expect(artifacts[0]!.symlinkTarget).toBeDefined();
    },
  );
});

describe("extractFrontmatter", () => {
  it("parses complete frontmatter", () => {
    const content = '---\ndescription: My rule\nglobs: "**/*.ts"\nalwaysApply: true\n---\nbody\n';
    expect(extractFrontmatter(content)).toEqual({
      description: "My rule",
      globs: "**/*.ts",
      alwaysApply: true,
    });
  });

  it("parses partial frontmatter (alwaysApply only)", () => {
    const content = "---\nalwaysApply: false\n---\nbody\n";
    expect(extractFrontmatter(content)).toEqual({
      alwaysApply: false,
    });
  });

  it("parses empty frontmatter block", () => {
    const content = "---\n---\nbody\n";
    expect(extractFrontmatter(content)).toEqual({});
  });

  it("returns undefined when no frontmatter present", () => {
    const content = "No frontmatter here.\nJust body.\n";
    expect(extractFrontmatter(content)).toBeUndefined();
  });

  it("returns undefined when frontmatter is not closed", () => {
    const content = "---\ndescription: unclosed\nbody\n";
    expect(extractFrontmatter(content)).toBeUndefined();
  });

  it("strips surrounding quotes from values", () => {
    const content = '---\ndescription: "quoted value"\nglobs: \'single quoted\'\n---\n';
    expect(extractFrontmatter(content)).toEqual({
      description: "quoted value",
      globs: "single quoted",
    });
  });

  it("flattens a YAML block list of globs to the comma-separated form", () => {
    const content =
      '---\ndescription: listed\nglobs:\n  - "src/**/*.ts"\n  - lib/**/*.ts\nalwaysApply: true\n---\nbody\n';
    expect(extractFrontmatter(content)).toEqual({
      description: "listed",
      globs: "src/**/*.ts,lib/**/*.ts",
      alwaysApply: true,
    });
  });

  it("flattens a YAML flow list of globs, respecting quoted commas", () => {
    const content = '---\nglobs: ["**/*.{ts,tsx}", \'src/**\']\n---\nbody\n';
    expect(extractFrontmatter(content)).toEqual({
      globs: "**/*.{ts,tsx},src/**",
    });
  });

  it("omits bare (null) description and globs keys instead of emitting empty strings", () => {
    const content = "---\ndescription:\nglobs:\nalwaysApply: false\n---\nbody\n";
    expect(extractFrontmatter(content)).toEqual({
      alwaysApply: false,
    });
  });

  it("ignores unknown frontmatter keys", () => {
    const content = "---\ndescription: test\nunknownKey: value\n---\n";
    expect(extractFrontmatter(content)).toEqual({
      description: "test",
    });
  });

  it("handles Windows-style line endings", () => {
    const content = "---\r\ndescription: test\r\n---\r\nbody\r\n";
    expect(extractFrontmatter(content)).toEqual({
      description: "test",
    });
  });
});

describe("cursorAdapter contract", () => {
  it("identifies itself and implements detect only", () => {
    expect(cursorAdapter.name).toBe("cursor");
    expect(cursorAdapter.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(() => cursorAdapter.importArtifacts({ rootDir: "." })).toThrow(
      /not implemented/,
    );
    expect(() => cursorAdapter.capabilities()).toThrow(/not implemented/);
    expect(() => cursorAdapter.plan({})).toThrow(/not implemented/);
    expect(() => cursorAdapter.emit({})).toThrow(/not implemented/);
  });
});

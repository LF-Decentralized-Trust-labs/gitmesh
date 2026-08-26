import { describe, expect, it } from "vitest";

import { normalizeInstructionMarkdown } from "./normalize.js";
import { parseScopeFrontmatter } from "./frontmatter.js";

describe("parseScopeFrontmatter", () => {
  it("parses Cursor .mdc frontmatter into a unified scope", () => {
    const { scope, body } = parseScopeFrontmatter(
      '---\ndescription: Style rules\nglobs: "src/**/*.{ts,tsx}"\nalwaysApply: false\n---\nUse tabs.\n',
    );
    expect(scope).toEqual({
      description: "Style rules",
      globs: ["src/**/*.{ts,tsx}"],
      alwaysApply: false,
    });
    expect(body).toBe("Use tabs.\n");
  });

  it("splits unquoted Cursor comma-list globs and de-duplicates", () => {
    const { scope } = parseScopeFrontmatter("---\nglobs: *.ts, *.tsx, *.ts\n---\n");
    expect(scope?.globs).toEqual(["*.ts", "*.tsx"]);
  });

  it("parses Copilot applyTo scalars, flow arrays and block lists as globs", () => {
    expect(parseScopeFrontmatter('---\napplyTo: "**/*.py"\n---\n').scope?.globs).toEqual([
      "**/*.py",
    ]);
    expect(
      parseScopeFrontmatter('---\napplyTo: ["app/**", "lib/**"] # scoped\n---\n').scope?.globs,
    ).toEqual(["app/**", "lib/**"]);
    expect(
      parseScopeFrontmatter("---\napplyTo:\n  - app/**\n  - lib/**\n---\n").scope?.globs,
    ).toEqual(["app/**", "lib/**"]);
  });

  it("parses alwaysApply: true and ignores unknown keys", () => {
    const { scope } = parseScopeFrontmatter("---\nalwaysApply: true\nfoo: bar\n---\n");
    expect(scope).toEqual({ globs: [], alwaysApply: true });
  });

  it("treats an unterminated opener as content, not frontmatter", () => {
    const content = "---\nnot frontmatter\n";
    expect(parseScopeFrontmatter(content)).toEqual({ body: content });
  });

  it("returns no scope for documents without frontmatter", () => {
    expect(parseScopeFrontmatter("# Title\n").scope).toBeUndefined();
  });
});

describe("frontmatter and normalization", () => {
  it("excludes frontmatter from content hashing so dialects compare equal", () => {
    const body = "# Style\n\nUse tabs.\n";
    const mdc = `---\ndescription: Style\nglobs: "**/*.ts"\n---\n${body}`;
    const instructionsMd = `---\napplyTo: "**/*.ts"\n---\n${body}`;
    expect(normalizeInstructionMarkdown(mdc).hash).toBe(normalizeInstructionMarkdown(body).hash);
    expect(normalizeInstructionMarkdown(mdc).hash).toBe(
      normalizeInstructionMarkdown(instructionsMd).hash,
    );
    expect(normalizeInstructionMarkdown(instructionsMd).scope?.globs).toEqual(["**/*.ts"]);
  });
});

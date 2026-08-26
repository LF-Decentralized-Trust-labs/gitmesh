import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isSameLogicalDocument, resolveLogicalPath } from "./symlink.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gitmesh-normalizer-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveLogicalPath", () => {
  it("resolves a symlinked instruction file to its target document", () => {
    const target = join(dir, "AGENTS.md");
    const link = join(dir, "CLAUDE.md");
    writeFileSync(target, "# Rules\n");
    symlinkSync("AGENTS.md", link);
    expect(resolveLogicalPath(link)).toBe(resolveLogicalPath(target));
  });

  it("returns undefined for missing files and broken symlinks", () => {
    const broken = join(dir, "CLAUDE.md");
    symlinkSync("does-not-exist.md", broken);
    expect(resolveLogicalPath(broken)).toBeUndefined();
    expect(resolveLogicalPath(join(dir, "nope.md"))).toBeUndefined();
  });
});

describe("isSameLogicalDocument", () => {
  it("treats CLAUDE.md → AGENTS.md as one logical document (zero drift)", () => {
    const target = join(dir, "AGENTS.md");
    const link = join(dir, "CLAUDE.md");
    writeFileSync(target, "# Rules\n");
    symlinkSync("AGENTS.md", link);
    expect(isSameLogicalDocument(link, target)).toBe(true);
  });

  it("distinguishes separate files and never matches unresolvable paths", () => {
    const a = join(dir, "AGENTS.md");
    const b = join(dir, "CLAUDE.md");
    writeFileSync(a, "# Rules\n");
    writeFileSync(b, "# Rules\n");
    expect(isSameLogicalDocument(a, b)).toBe(false);
    expect(isSameLogicalDocument(join(dir, "x.md"), join(dir, "x.md"))).toBe(false);
  });
});

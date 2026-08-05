import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertGoldenCase,
  listGoldenCases,
  readTreeAsGoldenOutputs,
  runGoldenCase,
  type GoldenRunner,
} from "./golden.js";

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

/** The simplest possible "adapter": emit the input tree unchanged. */
const identityRunner: GoldenRunner = (inputRepoDir) =>
  readTreeAsGoldenOutputs(inputRepoDir);

const tempDirs: string[] = [];
function tempExpectedDir(files: Record<string, string | Uint8Array>): string {
  const dir = mkdtempSync(join(tmpdir(), "gitmesh-golden-"));
  tempDirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("listGoldenCases", () => {
  it("discovers adapter/case pairs sorted deterministically", () => {
    const cases = listGoldenCases(fixturesRoot);
    expect(cases.map((c) => `${c.adapter}/${c.name}`)).toEqual([
      "claude-code/full-surface",
      "claude-code/no-artifacts",
      "claude-code/scoped-and-managed",
      "claude-code/user-scope-not-requested",
      "codex/codex-home-hint",
      "codex/full-surface",
      "codex/no-artifacts",
      "codex/user-and-managed",
      "copilot/full-surface",
      "copilot/instructions-frontmatter",
      "copilot/no-artifacts",
      "cursor/full-surface",
      "cursor/legacy-cursorrules",
      "cursor/mdc-frontmatter",
      "cursor/no-artifacts",
      "dummy/copy-through",
      "dummy/rejects-drift",
    ]);
    for (const c of cases) {
      expect(c.inputRepoDir).toBe(join(c.dir, "input-repo"));
      expect(c.expectedDir).toBe(join(c.dir, "expected"));
    }
  });

  it("throws on a case directory missing input-repo/ or expected/", () => {
    const root = tempExpectedDir({ "some-adapter/broken-case/expected/out.txt": "x\n" });
    expect(() => listGoldenCases(root)).toThrow(/missing .*input-repo/);
  });
});

describe("runGoldenCase", () => {
  it("passes the dummy copy-through fixture (T0.5 acceptance)", async () => {
    const copyThrough = listGoldenCases(fixturesRoot).find(
      (c) => c.adapter === "dummy" && c.name === "copy-through",
    )!;
    const result = await runGoldenCase(copyThrough, identityRunner);
    expect(result.differences).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("reports exactly the seeded drift in the negative fixture", async () => {
    const rejectsDrift = listGoldenCases(fixturesRoot).find(
      (c) => c.name === "rejects-drift",
    )!;
    const result = await runGoldenCase(rejectsDrift, identityRunner);
    expect(result.ok).toBe(false);
    expect(result.differences).toEqual([
      expect.objectContaining({ kind: "content", path: "AGENTS.md", firstDiffByte: 9 }),
      { kind: "unexpected", path: "extra.txt" },
      { kind: "missing", path: "only-expected.txt" },
    ]);
  });

  it("compares byte-exactly: LF vs CRLF is a difference", async () => {
    const expectedDir = tempExpectedDir({ "file.txt": "line one\r\nline two\r\n" });
    const result = await runGoldenCase(
      { inputRepoDir: expectedDir, expectedDir },
      () => [{ path: "file.txt", content: "line one\nline two\n" }],
    );
    expect(result.differences).toEqual([
      expect.objectContaining({ kind: "content", path: "file.txt", firstDiffByte: 8 }),
    ]);
  });

  it("compares byte-exactly: a missing trailing newline is a difference", async () => {
    const expectedDir = tempExpectedDir({ "file.txt": "content\n" });
    const result = await runGoldenCase(
      { inputRepoDir: expectedDir, expectedDir },
      () => [{ path: "file.txt", content: "content" }],
    );
    expect(result.differences).toEqual([
      expect.objectContaining({ kind: "content", path: "file.txt", firstDiffByte: 7 }),
    ]);
  });

  it("compares binary content", async () => {
    const bytes = Uint8Array.from([0x00, 0x01, 0xff, 0xfe]);
    const expectedDir = tempExpectedDir({ "blob.bin": bytes });
    const clean = await runGoldenCase(
      { inputRepoDir: expectedDir, expectedDir },
      () => [{ path: "blob.bin", content: Uint8Array.from(bytes) }],
    );
    expect(clean.ok).toBe(true);

    const tampered = await runGoldenCase(
      { inputRepoDir: expectedDir, expectedDir },
      () => [{ path: "blob.bin", content: Uint8Array.from([0x00, 0x01, 0xff, 0xff]) }],
    );
    expect(tampered.differences).toEqual([
      expect.objectContaining({ kind: "content", path: "blob.bin", firstDiffByte: 3 }),
    ]);
  });

  it("rejects runner paths that escape or are not normalized", async () => {
    const expectedDir = tempExpectedDir({});
    for (const path of ["../escape.txt", "/absolute.txt", "a/./b.txt", "a\\b.txt", ""]) {
      await expect(
        runGoldenCase({ inputRepoDir: expectedDir, expectedDir }, () => [
          { path, content: "x" },
        ]),
      ).rejects.toThrow(/invalid output path/);
    }
  });

  it("rejects duplicate runner output paths", async () => {
    const expectedDir = tempExpectedDir({});
    await expect(
      runGoldenCase({ inputRepoDir: expectedDir, expectedDir }, () => [
        { path: "a.txt", content: "1" },
        { path: "a.txt", content: "2" },
      ]),
    ).rejects.toThrow(/duplicate output path/);
  });

  // Creating file symlinks on Windows needs admin rights or Developer Mode.
  it.skipIf(process.platform === "win32")("rejects symlinks inside an expected tree", async () => {
    const expectedDir = tempExpectedDir({ "real.txt": "x\n" });
    symlinkSync(join(expectedDir, "real.txt"), join(expectedDir, "link.txt"));
    await expect(
      runGoldenCase({ inputRepoDir: expectedDir, expectedDir }, () => []),
    ).rejects.toThrow(/regular files only/);
  });
});

describe("assertGoldenCase", () => {
  it("resolves on a passing case", async () => {
    const copyThrough = listGoldenCases(fixturesRoot).find(
      (c) => c.adapter === "dummy" && c.name === "copy-through",
    )!;
    await expect(assertGoldenCase(copyThrough, identityRunner)).resolves.toBeUndefined();
  });

  it("throws a report naming every difference", async () => {
    const rejectsDrift = listGoldenCases(fixturesRoot).find(
      (c) => c.name === "rejects-drift",
    )!;
    await expect(assertGoldenCase(rejectsDrift, identityRunner)).rejects.toThrow(
      /differs:\s+AGENTS\.md at byte 9[\s\S]*unexpected: extra\.txt[\s\S]*missing:\s+only-expected\.txt/,
    );
  });
});

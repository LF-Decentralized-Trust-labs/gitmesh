import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { assertGoldenCase, listGoldenCases } from "./golden.js";
import type { AgentAdapter, DetectedArtifact, RepoContext } from "./types.js";

/**
 * Shared wiring for detector test suites (test-only; excluded from the
 * package build). Extracted from the T1.1/T1.2 suites so T1.3+ detectors
 * reuse the golden boilerplate, temp-repo factory, and symlink probe instead
 * of copying them.
 */

/** Absolute path of this package's golden fixtures root. */
export const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

/**
 * Loads a case's `options.json` (sibling of `input-repo/`, so never part of
 * the scanned tree); `{}` when absent. The options shape — and how relative
 * paths inside it resolve against the case directory — is adapter-specific,
 * so callers map the parsed value to a `RepoContext` themselves.
 */
export function loadCaseOptions<T>(caseDir: string): T {
  const optionsPath = join(caseDir, "options.json");
  return existsSync(optionsPath)
    ? (JSON.parse(readFileSync(optionsPath, "utf8")) as T)
    : ({} as T);
}

/**
 * The golden `describe` block every detector suite ships: the ≥3-cases /
 * negative-case acceptance check, the fixtures-declared-on-adapter check,
 * and one byte-exact assertion per case. `contextFor` maps a case directory
 * (holding the adapter-specific `options.json`) to the detector's context.
 */
export function describeDetectorGoldens(
  adapter: AgentAdapter,
  taskId: string,
  contextFor: (caseDir: string, inputRepoDir: string) => RepoContext,
): void {
  describe(`${adapter.name} golden fixtures`, () => {
    const goldenCases = listGoldenCases(fixturesRoot).filter(
      (c) => c.adapter === adapter.name,
    );

    it(`ships at least 3 cases including the negative one (${taskId} AC)`, () => {
      expect(goldenCases.length).toBeGreaterThanOrEqual(3);
      expect(goldenCases.map((c) => c.name)).toContain("no-artifacts");
    });

    it("declares its fixtures on the adapter, matching the on-disk cases", () => {
      expect(adapter.fixtures.map((f) => f.name)).toEqual(goldenCases.map((c) => c.name));
    });

    for (const goldenCase of goldenCases) {
      it(`matches ${goldenCase.name} byte-exactly`, async () => {
        await assertGoldenCase(goldenCase, (inputRepoDir) => [
          {
            path: "detected.json",
            content: serialize(adapter.detect(contextFor(goldenCase.dir, inputRepoDir))),
          },
        ]);
      });
    }
  });
}

function serialize(artifacts: readonly DetectedArtifact[]): string {
  return `${JSON.stringify(artifacts, null, 2)}\n`;
}

/**
 * Temp-directory factory whose directories are removed after each test.
 * Registers its own `afterEach`, so call it at test-module top level.
 */
export function useTempDirs(): {
  /** `mkdtemp` under the OS temp root, tracked for cleanup. */
  makeDir(prefix: string): string;
  /** Creates a temp repo populated with `files` and returns its root. */
  makeRepo(prefix: string, files: Record<string, string>): string;
} {
  const tempDirs: string[] = [];
  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });
  const makeDir = (prefix: string): string => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  };
  return {
    makeDir,
    makeRepo(prefix, files) {
      const root = makeDir(prefix);
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(root, dirname(path)), { recursive: true });
        writeFileSync(join(root, path), content);
      }
      return root;
    },
  };
}

/**
 * File symlinks need Developer Mode or admin rights on Windows; directory
 * links are created as junctions, which work unprivileged. Probed once per
 * test module; gate symlink tests with `it.skipIf`.
 */
export const symlinkSupport: { file: boolean; directory: boolean } = (() => {
  const dir = mkdtempSync(join(tmpdir(), "gitmesh-symlink-probe-"));
  let file = false;
  let directory = false;
  try {
    writeFileSync(join(dir, "target.txt"), "x");
    try {
      symlinkSync("target.txt", join(dir, "file-link"));
      file = true;
    } catch {
      /* unsupported */
    }
    mkdirSync(join(dir, "target-dir"));
    try {
      symlinkSync(join(dir, "target-dir"), join(dir, "dir-link"), "junction");
      directory = true;
    } catch {
      /* unsupported */
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { file, directory };
})();

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
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
 * the scanned tree); `{}` when absent. The options shape - and how relative
 * paths inside it resolve against the case directory - is adapter-specific,
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
 *
 * Fixture trees in git cannot contain symlinks (checkout differs across
 * platforms; the golden harness rejects them), so a case may declare links
 * in a `symlinks.json` sidecar (`{ "link": "target" }`, targets as literal
 * link contents). Such a case runs against a temp copy of `input-repo/`
 * with the links created - typed per resolved target so Windows works -
 * and is skipped where symlinks are unsupported. A case about links that
 * leave the repository (#500) adds an `outside/` tree, materialized next to
 * the copy so `../outside/...` targets escape the way they would in a real
 * checkout; `<outside>` in a target stands for its absolute path, and the
 * harness writes the placeholder back into `symlinkTarget` so the expected
 * output stays byte-exact on every machine.
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
    const temp = useTempDirs();

    it(`ships at least 3 cases including the negative one (${taskId} AC)`, () => {
      expect(goldenCases.length).toBeGreaterThanOrEqual(3);
      expect(goldenCases.map((c) => c.name)).toContain("no-artifacts");
    });

    it("declares its fixtures on the adapter, matching the on-disk cases", () => {
      expect(adapter.fixtures.map((f) => f.name)).toEqual(goldenCases.map((c) => c.name));
    });

    for (const goldenCase of goldenCases) {
      const symlinks = loadCaseSymlinks(goldenCase.dir);
      const needsSymlinks = Object.keys(symlinks).length > 0;
      it.skipIf(needsSymlinks && !symlinkSupport.file)(
        `matches ${goldenCase.name} byte-exactly`,
        async () => {
          await assertGoldenCase(goldenCase, (inputRepoDir) => {
            const { root, outsideDir } = needsSymlinks
              ? materializeWithSymlinks(goldenCase.dir, inputRepoDir, symlinks, temp.makeDir)
              : { root: inputRepoDir, outsideDir: undefined };
            const detected = adapter.detect(contextFor(goldenCase.dir, root));
            return [{ path: "detected.json", content: serialize(redactOutside(detected, outsideDir)) }];
          });
        },
      );
    }
  });
}

/** The `symlinks.json` sidecar of a golden case; `{}` when absent. */
function loadCaseSymlinks(caseDir: string): Record<string, string> {
  const sidecarPath = join(caseDir, "symlinks.json");
  return existsSync(sidecarPath)
    ? (JSON.parse(readFileSync(sidecarPath, "utf8")) as Record<string, string>)
    : {};
}

/** Stands for the materialized `outside/` tree in `symlinks.json` targets and in `expected/`. */
const OUTSIDE_PLACEHOLDER = "<outside>";

/**
 * Copies `inputRepoDir` to `<temp>/repo`, the case's `outside/` tree (if any)
 * to `<temp>/outside`, and creates the declared links.
 */
function materializeWithSymlinks(
  caseDir: string,
  inputRepoDir: string,
  symlinks: Record<string, string>,
  makeDir: (prefix: string) => string,
): { root: string; outsideDir: string | undefined } {
  const base = makeDir("gitmesh-golden-symlinks-");
  const root = join(base, "repo");
  cpSync(inputRepoDir, root, { recursive: true });
  let outsideDir: string | undefined;
  if (existsSync(join(caseDir, "outside"))) {
    outsideDir = join(base, "outside");
    cpSync(join(caseDir, "outside"), outsideDir, { recursive: true });
  }
  for (const [link, declared] of Object.entries(symlinks)) {
    const target =
      outsideDir === undefined ? declared : declared.replaceAll(OUTSIDE_PLACEHOLDER, outsideDir);
    const abs = join(root, link);
    mkdirSync(dirname(abs), { recursive: true });
    // Windows needs the link type; "dir" (not junction) keeps the literal
    // relative target intact, and needs the same privilege as file links.
    const resolved = resolve(dirname(abs), target);
    const type =
      existsSync(resolved) && statSync(resolved).isDirectory() ? "dir" : "file";
    symlinkSync(target, abs, type);
  }
  return { root, outsideDir };
}

/** Puts the placeholder back into literal targets that name the materialized `outside/` tree. */
function redactOutside(
  artifacts: readonly DetectedArtifact[],
  outsideDir: string | undefined,
): readonly DetectedArtifact[] {
  if (outsideDir === undefined) {
    return artifacts;
  }
  const prefix = outsideDir.replaceAll("\\", "/");
  return artifacts.map((artifact) =>
    artifact.symlinkTarget?.startsWith(prefix)
      ? { ...artifact, symlinkTarget: OUTSIDE_PLACEHOLDER + artifact.symlinkTarget.slice(prefix.length) }
      : artifact,
  );
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

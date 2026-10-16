/**
 * `census scan`: runs `gitmesh doctor --json` over every repository in a
 * manifest, as committed at its pinned commit, and writes one result per
 * repository to `<results>/<owner>/<name>.json`.
 *
 * Each repository is fetched shallowly into a fresh directory under the work
 * directory (the system temp directory unless `--work` names another),
 * audited, and deleted. Results already on disk for the same commit and
 * gitmesh version are kept, so an interrupted scan resumes where it stopped;
 * delete the results directory after changing doctor without bumping its
 * version.
 *
 * What a result depends on is the repository at its commit and the doctor in
 * this checkout, nothing else:
 * - git runs without the user's or the system's config, so no autocrlf,
 *   filter or credential setting of this machine changes the checkout. Git
 *   LFS content and submodules are not fetched: submodules are other
 *   repositories, with configuration of their own.
 * - doctor runs in process with its machine-level probes pinned off
 *   (org-managed settings, requirements.toml, the Antigravity CLI settings,
 *   CODEX_HOME), the way doctor's own golden tests run it, and without
 *   `--user`.
 * - doctor follows symlinks (#500), and a census must never read files of
 *   the machine running it. A symlink that resolves outside the checkout is
 *   re-pointed at a path that does not exist before doctor runs, so doctor
 *   reports it broken, as on any machine without that path.
 */
import { execFile } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runDoctor } from "../../cli/src/workspace/doctor.js";
import type { DoctorJson } from "../../lib/workspace-core/src/index.js";
import type { CensusManifest, CensusRepository } from "./manifest.js";
import { resultPath, type CensusResult } from "./result.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Version of the gitmesh-cli package whose doctor this checkout runs. */
export const GITMESH_VERSION: string = (
  JSON.parse(readFileSync(join(ROOT, "packages/gitmesh-cli/package.json"), "utf8")) as { version: string }
).version;

export interface ScanOptions {
  resultsDir: string;
  /** Where checkouts are made, one per repository in flight. Default: the system temp directory. */
  workDir?: string;
  /** Repositories fetched and audited at once. */
  concurrency: number;
  /** Fetch URL for a repository; tests point it at a local fixture. */
  remote?: (repo: string) => string;
}

/** Doctor's machine-level probes, pinned off as in its golden tests (`HERMETIC` in cli/src/__tests__/doctor.test.ts). */
const HERMETIC = {
  env: {},
  managedSettingsPaths: [],
  requirementsTomlPaths: [],
  antigravitySettingsPaths: [],
};

/** Where an outside symlink is re-pointed: relative, so it names no path of this machine, and never present. */
export const OUTSIDE_TARGET = ".gitmesh-census-outside-checkout";

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_LFS_SKIP_SMUDGE: "1",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
};

const execFileAsync = promisify(execFile);

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    env: GIT_ENV,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
  });
  return stdout;
}

/** The first line git wrote to stderr, which names what went wrong. */
function gitError(err: unknown): string {
  const stderr = (err as { stderr?: string }).stderr?.trim();
  return (stderr ? stderr.split("\n")[0] : undefined) ?? (err instanceof Error ? err.message : String(err));
}

/** Fetches `commit` alone, without history, into a new repository at `dir`. */
async function fetchCommit(dir: string, url: string, commit: string): Promise<void> {
  await git(["-c", "init.defaultBranch=census", "init", "--quiet", dir]);
  await git(["-C", dir, "fetch", "--quiet", "--depth=1", "--no-tags", "--no-recurse-submodules", url, commit]);
}

async function checkout(dir: string): Promise<void> {
  await git(["-C", dir, "-c", "advice.detachedHead=false", "checkout", "--quiet", "FETCH_HEAD"]);
}

/**
 * Re-points every tracked symlink in the checkout at `root` that resolves
 * outside it. One pass suffices: re-pointing a link can only break other
 * links' resolution, never send one outside.
 */
export async function neutralizeOutsideSymlinks(root: string): Promise<string[]> {
  const realRoot = await realpath(root);
  const neutralized: string[] = [];
  // `ls-files -s -z` entries read "<mode> <object> <stage>\t<path>"; 120000 is a symlink.
  for (const entry of (await git(["-C", root, "ls-files", "--stage", "-z"])).split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab === -1 || !entry.startsWith("120000 ")) continue;
    const path = entry.slice(tab + 1);
    const link = join(root, path);
    let resolved: string;
    try {
      resolved = await realpath(link);
    } catch {
      continue; // already broken: there is nothing to read through it
    }
    if (resolved === realRoot || resolved.startsWith(realRoot + sep)) continue;
    const target = await readlink(link);
    await unlink(link);
    await symlink(OUTSIDE_TARGET, link);
    neutralized.push(`${path} -> ${target}`);
  }
  return neutralized;
}

/** Fetches one repository at its pinned commit into `workDir`, audits it, and deletes the checkout. */
export async function scanRepository(
  { repo, commit }: CensusRepository,
  workDir: string,
  remote: (repo: string) => string = (name) => `https://github.com/${name}.git`,
): Promise<CensusResult> {
  const result: CensusResult = { repo, commit, gitmeshVersion: GITMESH_VERSION, status: "ok", outsideSymlinks: [] };
  const dir = await mkdtemp(join(workDir, `${repo.replace("/", "--")}-`));
  try {
    try {
      await fetchCommit(dir, remote(repo), commit);
    } catch (err) {
      return { ...result, status: "unavailable", error: gitError(err) };
    }
    try {
      await checkout(dir);
      result.outsideSymlinks = await neutralizeOutsideSymlinks(dir);
    } catch (err) {
      return { ...result, status: "failed", error: gitError(err) };
    }
    try {
      const { output } = await runDoctor({ dir, json: true, failOn: "none", context: HERMETIC });
      result.doctor = JSON.parse(output) as DoctorJson;
    } catch (err) {
      return { ...result, status: "failed", error: `doctor: ${err instanceof Error ? err.message : String(err)}` };
    }
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * A result from an earlier run worth keeping: same commit and doctor, and
 * not `unavailable`, which is retried in case the fetch failed in transit.
 */
async function isDone(file: string, commit: string): Promise<boolean> {
  try {
    const previous = JSON.parse(await readFile(file, "utf8")) as CensusResult;
    return previous.commit === commit && previous.gitmeshVersion === GITMESH_VERSION && previous.status !== "unavailable";
  } catch {
    return false;
  }
}

/** Scans every repository in `manifest`, `concurrency` at a time. */
export async function scan(manifest: CensusManifest, options: ScanOptions): Promise<void> {
  const { repositories } = manifest;
  const workDir = await mkdtemp(join(options.workDir ?? tmpdir(), "gitmesh-census-"));
  let next = 0;
  let finished = 0;
  const worker = async () => {
    while (next < repositories.length) {
      const entry = repositories[next++]!;
      const file = resultPath(options.resultsDir, entry.repo);
      let outcome = "kept from an earlier run";
      if (!(await isDone(file, entry.commit))) {
        const started = Date.now();
        const result = await scanRepository(entry, workDir, options.remote);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        outcome = result.status === "ok" ? `ok (${seconds}s)` : `${result.status}: ${result.error}`;
      }
      finished += 1;
      console.error(`scan: [${finished}/${repositories.length}] ${entry.repo} ${outcome}`);
    }
  };
  // A scan stopped with Ctrl-C or kill would otherwise leave its checkouts behind.
  const stop = (signal: NodeJS.Signals) => {
    rmSync(workDir, { recursive: true, force: true });
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", stop).once("SIGTERM", stop);
  try {
    await Promise.all(Array.from({ length: Math.min(options.concurrency, repositories.length) }, worker));
  } finally {
    process.off("SIGINT", stop).off("SIGTERM", stop);
    await rm(workDir, { recursive: true, force: true });
  }
}

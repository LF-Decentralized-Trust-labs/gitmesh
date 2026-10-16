/**
 * One repository's scan result, as `scan` writes it and `aggregate` reads
 * it: `<results>/<owner>/<name>.json`. Results quote the repositories'
 * instruction files (doctor's drift report does), so they stay on the
 * machine that ran the scan; only aggregate statistics are published.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DoctorJson } from "../../lib/workspace-core/src/index.js";
import type { CensusManifest } from "./manifest.js";

export interface CensusResult {
  repo: string;
  commit: string;
  /** gitmesh-cli version whose doctor produced `doctor`. */
  gitmeshVersion: string;
  /**
   * `unavailable`: the pinned commit could not be fetched (repository
   * deleted, made private, or history rewritten since discovery).
   * `failed`: the checkout or doctor itself failed.
   */
  status: "ok" | "unavailable" | "failed";
  error?: string;
  /** `path -> original target` for each symlink re-pointed because it resolved outside the checkout. */
  outsideSymlinks: string[];
  /** `gitmesh doctor --json`, present when `status` is `ok`. */
  doctor?: DoctorJson;
}

export function resultPath(resultsDir: string, repo: string): string {
  return join(resultsDir, `${repo}.json`);
}

/**
 * The result of every repository in `manifest`, in manifest order. Throws
 * when one is missing, belongs to another commit, or came from another
 * doctor version than the rest: a census mixes nothing.
 */
export function readResults(manifest: CensusManifest, resultsDir: string): CensusResult[] {
  const results = manifest.repositories.map(({ repo, commit }) => {
    const path = resultPath(resultsDir, repo);
    let result: CensusResult;
    try {
      result = JSON.parse(readFileSync(path, "utf8")) as CensusResult;
    } catch {
      throw new Error(`no scan result for ${repo} at ${path}; run census scan first`);
    }
    if (result.repo !== repo || result.commit !== commit) {
      throw new Error(`${path} is for ${result.repo}@${result.commit}, not ${repo}@${commit}`);
    }
    return result;
  });
  const versions = [...new Set(results.map((result) => result.gitmeshVersion))];
  if (versions.length > 1) {
    throw new Error(`results come from several gitmesh versions (${versions.join(", ")}); re-run census scan`);
  }
  return results;
}

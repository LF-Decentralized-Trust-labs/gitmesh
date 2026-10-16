/**
 * The census manifest: which repositories one census edition covers, each
 * pinned to the commit its default branch pointed at on discovery day.
 * `discover` writes it once; it is committed next to the published stats, so
 * `scan` and `aggregate` reproduce them later from the same commits however
 * the repositories have moved on.
 */
import { readFileSync } from "node:fs";

export const MANIFEST_SCHEMA_VERSION = 1;

export interface CensusRepository {
  /** `owner/name` on github.com. */
  repo: string;
  /** Default-branch commit on discovery day; the scan checks out exactly this. */
  commit: string;
  /** Stargazers on discovery day: the ranking key, recorded for readers. */
  stars: number;
  /** SPDX id of the license GitHub detected. */
  license: string;
}

export interface CensusManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  /** UTC date (YYYY-MM-DD) the repository list was taken. */
  discoveredOn: string;
  selection: {
    /** GitHub repository search walked in descending star order. */
    search: string;
    /** File that must exist at the root of the default branch. */
    requiredFile: string;
    /** Number of repositories selected. */
    limit: number;
  };
  /** In discovery order: descending stars. */
  repositories: CensusRepository[];
}

/**
 * Owner and repository names as GitHub allows them, minus `.` and `..`:
 * names become a git URL and a result file path, so nothing may climb
 * out of the results directory.
 */
export const REPO_PATTERN = /^[A-Za-z0-9-]+\/(?!\.\.?$)[A-Za-z0-9._-]+$/;
export const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Reads and validates a manifest. Repository names and commits reach `git`
 * as arguments, so anything off-pattern is rejected here rather than trusted
 * because the file is committed.
 */
export function readManifest(path: string): CensusManifest {
  const manifest = JSON.parse(readFileSync(path, "utf8")) as CensusManifest;
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`${path}: unsupported manifest schemaVersion ${String(manifest.schemaVersion)}`);
  }
  if (!Array.isArray(manifest.repositories)) {
    throw new Error(`${path}: repositories must be an array`);
  }
  const seen = new Set<string>();
  for (const { repo, commit } of manifest.repositories) {
    if (!REPO_PATTERN.test(repo)) {
      throw new Error(`${path}: invalid repository name ${JSON.stringify(repo)}`);
    }
    if (!COMMIT_PATTERN.test(commit)) {
      throw new Error(`${path}: invalid commit ${JSON.stringify(commit)} for ${repo}`);
    }
    if (seen.has(repo)) throw new Error(`${path}: ${repo} is listed twice`);
    seen.add(repo);
  }
  return manifest;
}

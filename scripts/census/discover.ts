/**
 * `census discover`: picks the repositories a census edition covers.
 *
 * Walks GitHub's repository search in descending star order and keeps the
 * first `limit` repositories that are public, not forks, not archived, not
 * mirrors, carry a license GitHub can name, and have an AGENTS.md at the root
 * of their default branch. Each is pinned to its default-branch commit. One
 * GraphQL request per page answers all of it, including whether
 * `HEAD:AGENTS.md` exists, so discovery costs a few dozen requests and clones
 * nothing.
 *
 * Search returns at most 1,000 results per query, so the walk runs in
 * slices: once a slice is exhausted, the next query caps stars just above
 * the lowest count seen. The margin covers search ranking by an index that
 * lags live star counts; repositories seen twice are skipped. Every query
 * also carries a star floor: sorting all 350M+ public repositories times
 * out on GitHub's side and comes back partial and out of order.
 */
import { MANIFEST_SCHEMA_VERSION, REPO_PATTERN, type CensusManifest, type CensusRepository } from "./manifest.js";

export const SEARCH = "is:public fork:false archived:false mirror:false sort:stars-desc";
/** No census walks below this; the top 500 with an AGENTS.md sit far above it. */
export const STAR_FLOOR = 1000;
export const REQUIRED_FILE = "AGENTS.md";
/** Results GitHub search returns for one query, however many match. */
export const SEARCH_CAP = 1000;
const PAGE_SIZE = 100;

/** One repository as the search query below returns it. */
export interface SearchNode {
  nameWithOwner: string;
  stargazerCount: number;
  isFork: boolean;
  isArchived: boolean;
  isMirror: boolean;
  isPrivate: boolean;
  licenseInfo: { spdxId: string | null; pseudoLicense: boolean } | null;
  defaultBranchRef: { target: { oid: string } | null } | null;
  /** `HEAD:AGENTS.md`: a `Blob` when the file exists (symlinks included), else null. */
  requiredFile: { __typename: string } | null;
}

export interface SearchPage {
  repositoryCount: number;
  /** GitHub returns null for a result it will not show, e.g. a repository blocked by a takedown. */
  nodes: Array<SearchNode | null>;
  endCursor: string | null;
}

/** Fetches one page of `query`, starting after `after`. */
export type SearchFn = (query: string, after: string | undefined) => Promise<SearchPage>;

const SEARCH_QUERY = `
  query Census($query: String!, $after: String) {
    search(query: $query, type: REPOSITORY, first: ${PAGE_SIZE}, after: $after) {
      repositoryCount
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on Repository {
          nameWithOwner
          stargazerCount
          isFork
          isArchived
          isMirror
          isPrivate
          licenseInfo { spdxId pseudoLicense }
          defaultBranchRef { target { oid } }
          requiredFile: object(expression: "HEAD:${REQUIRED_FILE}") { __typename }
        }
      }
    }
  }
`;

/** The manifest entry for `node`, or undefined when it falls outside the selection. */
export function toCensusRepository(node: SearchNode): CensusRepository | undefined {
  const license = node.licenseInfo;
  const commit = node.defaultBranchRef?.target?.oid;
  if (node.isFork || node.isArchived || node.isMirror || node.isPrivate) return undefined;
  // `pseudoLicense` marks GitHub's "Other" (NOASSERTION): a license file it could not name.
  if (!license?.spdxId || license.pseudoLicense) return undefined;
  if (node.requiredFile?.__typename !== "Blob" || commit === undefined) return undefined;
  if (!REPO_PATTERN.test(node.nameWithOwner)) return undefined;
  return { repo: node.nameWithOwner, commit, stars: node.stargazerCount, license: license.spdxId };
}

/** Star cap for the next slice: the lowest count seen, plus 1% (at least 10) for index lag. */
function nextCeiling(lowest: number): number {
  return lowest + Math.max(10, Math.ceil(lowest / 100));
}

/**
 * The first `limit` eligible repositories in search order; fewer when the
 * walk reaches {@link STAR_FLOOR} first.
 */
export async function selectRepositories(
  search: SearchFn,
  limit: number,
  onSlice: (query: string, selected: number) => void = () => {},
): Promise<CensusRepository[]> {
  const selected: CensusRepository[] = [];
  const seen = new Set<string>();
  let ceiling: number | undefined;
  for (;;) {
    const stars = ceiling === undefined ? `>=${STAR_FLOOR}` : `${STAR_FLOOR}..${ceiling}`;
    const query = `${SEARCH} stars:${stars}`;
    onSlice(query, selected.length);
    let after: string | undefined;
    let returned = 0;
    let total = 0;
    let lowest = Number.POSITIVE_INFINITY;
    do {
      const page = await search(query, after);
      total = page.repositoryCount;
      for (const node of page.nodes) {
        returned += 1;
        if (node === null) continue;
        lowest = Math.min(lowest, node.stargazerCount);
        if (seen.has(node.nameWithOwner)) continue;
        seen.add(node.nameWithOwner);
        const repository = toCensusRepository(node);
        if (repository === undefined) continue;
        selected.push(repository);
        if (selected.length === limit) return selected;
      }
      after = page.endCursor ?? undefined;
    } while (after !== undefined);
    if (returned >= total || lowest === Number.POSITIVE_INFINITY) return selected;
    const next = nextCeiling(lowest);
    if (ceiling !== undefined && next >= ceiling) {
      throw new Error(`more than ${SEARCH_CAP} repositories have about ${lowest} stars; the search cannot be sliced further`);
    }
    ceiling = next;
  }
}

/** Builds the manifest for an edition discovered on `today` (YYYY-MM-DD). */
export async function discover(search: SearchFn, limit: number, today: string): Promise<CensusManifest> {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    discoveredOn: today,
    selection: { search: `${SEARCH} stars:>=${STAR_FLOOR}`, requiredFile: REQUIRED_FILE, limit },
    repositories: await selectRepositories(search, limit, (query, selected) =>
      console.error(`discover: ${selected}/${limit} selected; searching ${query}`),
    ),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface SearchResponse {
  data?: {
    search: {
      repositoryCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<SearchNode | null>;
    };
  } | null;
  errors?: unknown;
}

/**
 * A `SearchFn` backed by the GitHub GraphQL API. Retries server errors, rate
 * limiting, cut-off bodies and query timeouts (a 200 whose `data` is null)
 * with backoff, honoring `retry-after`; gives up after five retries.
 */
export function githubSearch(token: string): SearchFn {
  return async (query, after) => {
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          authorization: `bearer ${token}`,
          "content-type": "application/json",
          "user-agent": "gitmesh-census",
        },
        body: JSON.stringify({ query: SEARCH_QUERY, variables: { query, after: after ?? null } }),
      });
      const text = await response.text();
      let body: SearchResponse | undefined;
      try {
        body = JSON.parse(text) as SearchResponse;
      } catch {
        // A slow search can end in an empty or truncated body, even on a 200.
      }
      const data = body?.data;
      if (response.ok && data) {
        const { repositoryCount, pageInfo, nodes } = data.search;
        return { repositoryCount, nodes, endCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null };
      }
      const retryable = response.ok || response.status >= 500 || response.status === 403 || response.status === 429;
      if (!retryable || attempt === 6) {
        throw new Error(`GitHub GraphQL returned ${response.status}: ${text.slice(0, 500)}`);
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000);
    }
  };
}

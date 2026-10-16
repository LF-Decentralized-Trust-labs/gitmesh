import { describe, expect, it } from "vitest";
import {
  SEARCH,
  STAR_FLOOR,
  discover,
  selectRepositories,
  toCensusRepository,
  type SearchFn,
  type SearchNode,
} from "../census/discover.js";

/**
 * Census discovery (pivot T2.4) against a fake GitHub search: which
 * repositories qualify, and how the walk slices search results by star
 * count to get past the cap on results per query. No network.
 */

const COMMIT = "a".repeat(40);

function node(name: string, stars: number, extra: Partial<SearchNode> = {}): SearchNode {
  return {
    nameWithOwner: name,
    stargazerCount: stars,
    isFork: false,
    isArchived: false,
    isMirror: false,
    isPrivate: false,
    licenseInfo: { spdxId: "MIT", pseudoLicense: false },
    defaultBranchRef: { target: { oid: COMMIT } },
    requiredFile: { __typename: "Blob" },
    ...extra,
  };
}

/**
 * Serves `nodes` the way GitHub search does: filtered by the query's
 * `stars:` qualifier, sorted by stars, paged, and truncated after `cap`
 * results however many match. Records every query it answers.
 */
function fakeSearch(nodes: SearchNode[], { cap = 4, pageSize = 2 } = {}) {
  const queries: string[] = [];
  const search: SearchFn = async (query, after) => {
    if (after === undefined) queries.push(query);
    const range = /stars:(?:>=(\d+)|(\d+)\.\.(\d+))$/.exec(query);
    if (!range || !query.startsWith(`${SEARCH} `)) throw new Error(`unexpected query ${query}`);
    const low = Number(range[1] ?? range[2]);
    const high = range[3] === undefined ? Number.POSITIVE_INFINITY : Number(range[3]);
    const matching = nodes
      .filter((n) => n.stargazerCount >= low && n.stargazerCount <= high)
      .sort((a, b) => b.stargazerCount - a.stargazerCount);
    const start = after === undefined ? 0 : Number(after);
    const end = Math.min(start + pageSize, cap, matching.length);
    return {
      repositoryCount: matching.length,
      nodes: matching.slice(start, end),
      endCursor: end < Math.min(cap, matching.length) ? String(end) : null,
    };
  };
  return { search, queries };
}

describe("census discovery: eligibility", () => {
  it("takes a public, licensed repository with a root AGENTS.md, pinned to its default-branch commit", () => {
    expect(toCensusRepository(node("acme/tool", 5000))).toEqual({
      repo: "acme/tool",
      commit: COMMIT,
      stars: 5000,
      license: "MIT",
    });
  });

  it.each<[string, Partial<SearchNode>]>([
    ["a fork", { isFork: true }],
    ["an archived repository", { isArchived: true }],
    ["a mirror", { isMirror: true }],
    ["a private repository", { isPrivate: true }],
    ["no license", { licenseInfo: null }],
    ["a license GitHub cannot name", { licenseInfo: { spdxId: "NOASSERTION", pseudoLicense: true } }],
    ["no AGENTS.md", { requiredFile: null }],
    ["a directory named AGENTS.md", { requiredFile: { __typename: "Tree" } }],
    ["an empty repository", { defaultBranchRef: null }],
    ["a name git could mistake for a path", { nameWithOwner: "acme/.." }],
  ])("skips %s", (_case, extra) => {
    expect(toCensusRepository(node("acme/tool", 5000, extra))).toBeUndefined();
  });
});

describe("census discovery: the walk", () => {
  it("keeps the first eligible repositories in star order and stops at the limit", async () => {
    const { search } = fakeSearch([
      node("a/one", 9000),
      node("a/fork", 8000, { isFork: true }),
      node("a/two", 7000),
      node("a/three", 6000),
    ]);
    const selected = await selectRepositories(search, 2);
    expect(selected.map((r) => r.repo)).toEqual(["a/one", "a/two"]);
  });

  it("slices past the per-query cap, overlapping by a margin and skipping repeats", async () => {
    const stars = [50_000, 40_000, 30_000, 20_000, 10_000, 9_000, 8_000, 7_000, 6_000, 5_000];
    const { search, queries } = fakeSearch(stars.map((count, i) => node(`a/r${i}`, count)));
    const selected = await selectRepositories(search, 100);
    expect(selected.map((r) => r.stars)).toEqual(stars);
    expect(queries).toEqual([
      `${SEARCH} stars:>=${STAR_FLOOR}`,
      // the lowest count seen, 20,000, plus 1% for index lag
      `${SEARCH} stars:${STAR_FLOOR}..20200`,
      // the third slice returns all that is left, so the walk ends there
      `${SEARCH} stars:${STAR_FLOOR}..8080`,
    ]);
  });

  it("returns what it found when the walk reaches the star floor first", async () => {
    const { search } = fakeSearch([node("a/one", 9000), node("a/two", 8000)]);
    expect(await selectRepositories(search, 500)).toHaveLength(2);
  });

  it("refuses to loop when more repositories share a star count than one query returns", async () => {
    const { search } = fakeSearch(Array.from({ length: 6 }, (_, i) => node(`a/tie${i}`, 5000)));
    await expect(selectRepositories(search, 500)).rejects.toThrow(/cannot be sliced further/);
  });

  it("skips results GitHub withholds", async () => {
    const search: SearchFn = async () => ({
      repositoryCount: 2,
      nodes: [null, node("a/one", 9000)],
      endCursor: null,
    });
    expect((await selectRepositories(search, 5)).map((r) => r.repo)).toEqual(["a/one"]);
  });

  it("records the selection it applied in the manifest", async () => {
    const { search } = fakeSearch([node("a/one", 9000)]);
    const manifest = await discover(search, 1, "2026-10-16");
    expect(manifest).toEqual({
      schemaVersion: 1,
      discoveredOn: "2026-10-16",
      selection: { search: `${SEARCH} stars:>=${STAR_FLOOR}`, requiredFile: "AGENTS.md", limit: 1 },
      repositories: [{ repo: "a/one", commit: COMMIT, stars: 9000, license: "MIT" }],
    });
  });
});

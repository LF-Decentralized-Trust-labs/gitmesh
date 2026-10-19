import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runDoctor } from "../../cli/src/workspace/doctor.js";
import type { DoctorJson } from "../../lib/workspace-core/src/index.js";
import { aggregate } from "../census/aggregate.js";
import type { CensusManifest } from "../census/manifest.js";
import { renderStatsMarkdown } from "../census/render.js";
import { readResults, type CensusResult } from "../census/result.js";

/**
 * Census aggregation (pivot T2.4). Repositories are real doctor runs over
 * small fixture trees, so the definitions are tested against doctor's actual
 * `--json` output rather than a hand-written imitation of it.
 */

const HERMETIC = { env: {}, managedSettingsPaths: [], requirementsTomlPaths: [], antigravitySettingsPaths: [] };
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** `gitmesh doctor --json` over a fixture tree of `files` and `links` (path → symlink target). */
async function doctorOn(files: Record<string, string>, links: Record<string, string> = {}): Promise<DoctorJson> {
  const root = mkdtempSync(join(tmpdir(), "census-aggregate-"));
  tempDirs.push(root);
  mkdirSync(join(root, ".git"));
  const place = (path: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    return join(root, path);
  };
  for (const [path, content] of Object.entries(files)) writeFileSync(place(path), content);
  for (const [path, target] of Object.entries(links)) symlinkSync(target, place(path));
  const { output } = await runDoctor({ dir: root, json: true, failOn: "none", context: HERMETIC });
  return JSON.parse(output) as DoctorJson;
}

const AGENTS_MD = "# Rules\n\nUse pnpm for installs.\n\nRun the tests before every commit.\n\nSign off every commit.\n";

/** A doctor report for a scanned repository, or why one could not be scanned. */
type Scanned = DoctorJson | Exclude<CensusResult["status"], "ok">;

/** A census of one repository per entry of `reports`, in that order. */
function census(reports: readonly Scanned[]): { manifest: CensusManifest; results: CensusResult[] } {
  const results = reports.map((report, i): CensusResult => {
    const base = { repo: `acme/repo${i}`, commit: String(i).padStart(40, "0"), gitmeshVersion: "0.0.0-test", outsideSymlinks: [] };
    return typeof report === "string"
      ? { ...base, status: report, error: "gone" }
      : { ...base, status: "ok", doctor: report };
  });
  const manifest: CensusManifest = {
    schemaVersion: 1,
    discoveredOn: "2026-10-16",
    selection: { search: "is:public sort:stars-desc stars:>=1000", requiredFile: "AGENTS.md", limit: results.length },
    repositories: results.map(({ repo, commit }, i) => ({ repo, commit, stars: 1000 - i, license: "MIT" })),
  };
  return { manifest, results };
}

function statsOf(reports: readonly Scanned[]) {
  const { manifest, results } = census(reports);
  return aggregate(manifest, results);
}

describe("census aggregate: root instruction files", () => {
  it("classifies each root instruction file by how it relates to AGENTS.md", async () => {
    const report = await doctorOn(
      {
        "AGENTS.md": AGENTS_MD,
        // The #6235 shim, which doctor leaves out of its diff.
        "CLAUDE.md": "@AGENTS.md\n\nClaude-only notes.\n",
        // An import doctor does diff, because only CLAUDE.md counts as a shim.
        "GEMINI.md": "@AGENTS.md\n",
        ".github/copilot-instructions.md": "# Rules\n\nUse npm for installs.\n\nRun the tests before every commit.\n",
        ".cursorrules": AGENTS_MD,
        ".windsurfrules": "Follow the instructions in AGENTS.md.\n",
        "AGENT.md": "# Roo\n\nPrefer small modules.\n\nDocument public APIs.\n\nKeep functions pure.\n",
      },
      { ".clinerules": "AGENTS.md", ".roorules": "missing.md" },
    );
    const { instructions } = statsOf([report]);
    const relationOf = Object.fromEntries(
      Object.entries(instructions.rootFiles).map(([path, counts]) => [
        path,
        Object.entries(counts).find(([relation, count]) => relation !== "repositories" && count === 1)?.[0],
      ]),
    );
    expect(relationOf).toEqual({
      ".clinerules": "symlink",
      ".cursorrules": "identical",
      ".github/copilot-instructions.md": "diverged",
      ".roorules": "unreadable",
      ".windsurfrules": "pointer",
      "AGENT.md": "separate",
      "CLAUDE.md": "import",
      "GEMINI.md": "import",
    });
    expect(instructions.withAnotherRootFile).toBe(1);
    expect(instructions.withDivergedCopy).toBe(1);
  });

  it("counts a pointer only when the shorter file is short and names the other", async () => {
    const long = (text: string) => `${text}\n\nOne.\n\nTwo.\n\nThree.\n\nFour.\n`;
    const pointer = await doctorOn({ "AGENTS.md": AGENTS_MD, "CLAUDE.md": "See AGENTS.md.\n" });
    // AGENTS.md is the stub here, pointing at CLAUDE.md.
    const reversed = await doctorOn({ "AGENTS.md": "Read CLAUDE.md first.\n", "CLAUDE.md": long("# Claude") });
    const unnamed = await doctorOn({ "AGENTS.md": AGENTS_MD, "CLAUDE.md": "Be concise.\n" });
    const longNaming = await doctorOn({ "AGENTS.md": AGENTS_MD, "CLAUDE.md": long("Unlike AGENTS.md, this file is for Claude.") });
    const { instructions } = statsOf([pointer, reversed, unnamed, longNaming]);
    expect(instructions.rootFiles["CLAUDE.md"]).toMatchObject({ repositories: 4, pointer: 2, separate: 2 });
  });

  it("counts an @AGENTS.md line as an import only where the agent expands imports", async () => {
    const copilot = await doctorOn({ "AGENTS.md": AGENTS_MD, ".github/copilot-instructions.md": "@AGENTS.md\n" });
    const { instructions } = statsOf([copilot]);
    expect(instructions.rootFiles[".github/copilot-instructions.md"]).toMatchObject({ import: 0, pointer: 1 });
  });

  it("counts nested AGENTS.md files and doctor's own drift verdicts", async () => {
    const nested = await doctorOn({ "AGENTS.md": AGENTS_MD, "packages/app/AGENTS.md": "# App\n\nUse vitest.\n" });
    const linked = await doctorOn({ "AGENTS.md": AGENTS_MD }, { "CLAUDE.md": "AGENTS.md" });
    const drifting = await doctorOn({ "AGENTS.md": AGENTS_MD, "CLAUDE.md": "# Rules\n\nUse npm.\n" });
    const { instructions, drift } = statsOf([nested, linked, drifting]);
    expect(instructions.nestedAgentsMd).toBe(1);
    expect(instructions.withDivergedCopy).toBe(1);
    expect(drift).toEqual({ compared: 1, drifting: 1 });
  });
});

describe("census aggregate: agent-specific configuration", () => {
  it("credits a file to the one agent that claims it, never the shared AGENTS.md, and counts shared files apart", async () => {
    const plain = await doctorOn({ "AGENTS.md": AGENTS_MD, "packages/app/AGENTS.md": "# App\n" });
    const busy = await doctorOn({
      "AGENTS.md": AGENTS_MD,
      "CLAUDE.md": "@AGENTS.md\n",
      ".claude/skills/pdf/SKILL.md": "---\nname: pdf\ndescription: PDFs\n---\nUse it.\n",
      ".agents/skills/pdf/SKILL.md": "---\nname: pdf\ndescription: PDFs\n---\nUse it.\n",
      ".mcp.json": '{"mcpServers":{}}\n',
      ".cursor/mcp.json": '{"mcpServers":{}}\n',
      ".cursorrules": "Use tabs.\n",
    });
    const { agents, mcp, skills } = statsOf([plain, busy]);
    expect(agents.withOwnConfig).toBe(1);
    expect(agents.perRepository).toEqual({ "0": 1, "1": 0, "2": 0, "3": 1, "4+": 0 });
    expect(agents.byAgent["claude-code"]).toEqual({
      repositories: 1,
      instructions: 1,
      mcp: 1,
      skills: 1,
      commands: 0,
      settings: 0,
    });
    expect(agents.byAgent.codex).toMatchObject({ repositories: 1, skills: 1 });
    expect(agents.byAgent.cursor).toMatchObject({ repositories: 1, mcp: 1, instructions: 0 });
    expect(agents.byAgent.cline).toMatchObject({ repositories: 0 });
    expect(agents.byAgent).not.toHaveProperty("agentsmd");
    expect(agents.byAgent).not.toHaveProperty("third-party-managers");
    expect(agents.sharedFiles).toEqual({ ".cursorrules": 1 });
    expect(mcp).toEqual({ repositories: 1, severalAgents: 1 });
    expect(skills).toEqual({ repositories: 1, severalAgents: 1, sameSkillSeveralAgents: 1, sameSkillCopied: 1 });
  });

  it("tells a skill copied into two agents' directories from one linked into the second", async () => {
    const skill = "---\nname: pdf\ndescription: PDFs\n---\nUse it.\n";
    const linkedDir = await doctorOn(
      { "AGENTS.md": AGENTS_MD, ".agents/skills/pdf/SKILL.md": skill, ".claude/settings.json": "{}\n" },
      { ".claude/skills": "../.agents/skills" },
    );
    const linkedFile = await doctorOn(
      { "AGENTS.md": AGENTS_MD, ".agents/skills/pdf/SKILL.md": skill },
      { ".claude/skills/pdf/SKILL.md": "../../../.agents/skills/pdf/SKILL.md" },
    );
    const { skills } = statsOf([linkedDir, linkedFile]);
    expect(skills).toEqual({ repositories: 2, severalAgents: 2, sameSkillSeveralAgents: 2, sameSkillCopied: 0 });
  });
});

/** A hand-built report: only the fields findings, managers and scores read. */
function stub(score: number, findings: Array<[string, "error" | "warning" | "info"]>, managers: string[] = []): DoctorJson {
  return {
    schemaVersion: 1,
    summary: { score, artifacts: 1, adapters: 1, findings: { error: 0, warning: 0, info: 0 }, driftingPairs: 0 },
    artifacts: [
      { adapter: "codex", path: "AGENTS.md", kind: "instructions", scope: "project" },
      ...managers.map((manager) => ({ adapter: "third-party-managers", path: `${manager}.toml`, kind: "config", scope: "project" as const, manager })),
    ],
    drift: { documents: [], symlinkGroups: [], pairs: [], divergentBlocks: [] },
    findings: findings.map(([ruleId, severity]) => ({ ruleId, severity, message: "m" })),
  };
}

describe("census aggregate: findings, managers, scores and the population", () => {
  const { manifest, results } = census([
    stub(100, []),
    stub(75, [["GM002", "warning"], ["GM002", "warning"], ["GM010", "warning"]], ["ruler"]),
    stub(40, [["GM001", "error"], ["GM003", "error"]], ["ruler", "skills-lock"]),
    "unavailable",
    "failed",
  ]);
  const stats = aggregate(manifest, results);

  it("counts repositories and findings per rule, listing every rule", () => {
    expect(Object.keys(stats.findings)).toEqual(
      ["GM001", "GM002", "GM003", "GM004", "GM005", "GM006", "GM007", "GM008", "GM009", "GM010", "GM011"],
    );
    expect(stats.findings.GM002).toEqual({ severity: "warning", repositories: 1, findings: 2 });
    expect(stats.findings.GM001).toEqual({ severity: "error", repositories: 1, findings: 1 });
    expect(stats.findings.GM011).toEqual({ severity: "warning", repositories: 0, findings: 0 });
  });

  it("counts managers once per repository, and scores by bucket", () => {
    expect(stats.managers).toEqual({ ruler: 2, "skills-lock": 1 });
    expect(stats.scores).toEqual({ median: 75, buckets: { "100": 1, "90-99": 0, "75-89": 1, "50-74": 0, "0-49": 1 } });
  });

  it("separates scanned repositories from those that could not be", () => {
    expect(stats.repositories).toEqual({ selected: 5, scanned: 3, unavailable: 1, failed: 1 });
    expect(stats.edition).toEqual({ ...manifest.selection, discoveredOn: "2026-10-16", gitmeshVersion: "0.0.0-test" });
  });
});

describe("census aggregate: output", () => {
  it("is deterministic and independent of result order", async () => {
    // Each repository brings keys the others lack, so insertion order differs between the two orders.
    const reports = [
      await doctorOn({ "AGENTS.md": AGENTS_MD, "GEMINI.md": "See AGENTS.md.\n", ".windsurfrules": "Tabs.\n" }),
      await doctorOn({ "AGENTS.md": AGENTS_MD, "CLAUDE.md": "See AGENTS.md.\n", ".cursorrules": "Tabs.\n" }),
      stub(80, [["GM004", "warning"]], ["symlinks"]),
      stub(70, [], ["ruler"]),
    ];
    const forward = census(reports);
    const backward = census([...reports].reverse());
    const render = (c: typeof forward) => renderStatsMarkdown(aggregate(c.manifest, c.results));
    expect(JSON.stringify(aggregate(backward.manifest, backward.results))).toBe(
      JSON.stringify(aggregate(forward.manifest, forward.results)),
    );
    expect(render(backward)).toBe(render(forward));
  });

  it("publishes counts only: no repository names, paths of the scanned trees or file text", async () => {
    const report = await doctorOn({ "AGENTS.md": AGENTS_MD, "CLAUDE.md": "Quoted-only-in-results text.\n" });
    const stats = statsOf([report]);
    for (const output of [JSON.stringify(stats), renderStatsMarkdown(stats)]) {
      expect(output).not.toContain("acme/");
      expect(output).not.toContain("Quoted-only-in-results");
      expect(output).not.toContain("Use pnpm");
    }
  });

  it("renders the statistics as stats.md", async () => {
    const reports: Scanned[] = [
      await doctorOn({ "AGENTS.md": AGENTS_MD }, { "CLAUDE.md": "AGENTS.md" }),
      await doctorOn({
        "AGENTS.md": AGENTS_MD,
        "CLAUDE.md": "@AGENTS.md\n",
        ".github/copilot-instructions.md": "# Rules\n\nUse npm for installs.\n",
        ".claude/skills/pdf/SKILL.md": "---\nname: pdf\ndescription: PDFs\n---\nUse it.\n",
        ".mcp.json": '{"mcpServers":{}}\n',
      }),
      stub(55, [["GM001", "error"], ["GM002", "warning"]], ["ruler"]),
      "unavailable",
    ];
    await expect(renderStatsMarkdown(statsOf(reports))).toMatchFileSnapshot("./__snapshots__/census-stats.md");
  });

  it("refuses an artifact kind it does not map, rather than miscounting it", () => {
    const report = stub(100, []);
    const odd = { ...report, artifacts: [{ adapter: "codex", path: ".codex/new.thing", kind: "new-kind", scope: "project" as const }] };
    expect(() => statsOf([odd])).toThrow(/artifact kind "new-kind"/);
  });
});

describe("census results", () => {
  const dir = mkdtempSync(join(tmpdir(), "census-results-"));
  tempDirs.push(dir);
  const { manifest, results } = census([stub(100, []), stub(90, [])]);
  const write = (result: CensusResult) => {
    mkdirSync(join(dir, "acme"), { recursive: true });
    writeFileSync(join(dir, `${result.repo}.json`), JSON.stringify(result));
  };

  it("reads every result in manifest order", () => {
    results.forEach(write);
    expect(readResults(manifest, dir).map((result) => result.repo)).toEqual(["acme/repo0", "acme/repo1"]);
  });

  it("refuses a missing result, one for another commit, and mixed doctor versions", () => {
    rmSync(join(dir, "acme/repo1.json"));
    expect(() => readResults(manifest, dir)).toThrow(/no scan result for acme\/repo1/);
    write({ ...results[1]!, commit: "f".repeat(40) });
    expect(() => readResults(manifest, dir)).toThrow(/is for acme\/repo1@f+/);
    write({ ...results[1]!, gitmeshVersion: "9.9.9" });
    expect(() => readResults(manifest, dir)).toThrow(/several gitmesh versions/);
  });
});

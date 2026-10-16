/**
 * `census aggregate`: per-repository doctor reports in, the statistics one
 * census edition publishes out (`stats.json`, rendered as `stats.md`).
 *
 * Only counts leave this module: no repository names and no file text. The
 * drift report's quoted blocks are read here, to tell a one-line pointer or
 * an `@AGENTS.md` import from a separate document, and then dropped. Pure
 * and deterministic: the same manifest and results give byte-identical
 * output.
 *
 * Definitions (scripts/census/README.md explains them for readers):
 * - Repository tier only: project and local artifacts. User and managed
 *   artifacts are machine state, and the scan pins those probes off anyway.
 * - AGENTS.md, at any depth, is the shared standard every AGENTS.md-reading
 *   agent inventories, so it is no one agent's own configuration.
 * - An agent has configuration of its own when doctor inventoried a file for
 *   it that no other agent claims: GM008's notion of a distinctive artifact.
 *   Files several agents claim, such as `.cursorrules` (Cursor and Cline),
 *   are counted as shared files instead. The third-party-managers adapter is
 *   not an agent.
 * - Root instruction files are the documents doctor diffs (`isDriftDocument`
 *   in cli/src/workspace/doctor.ts); each one besides AGENTS.md is classified
 *   by how it relates to AGENTS.md (see RELATIONS).
 */
import { basename, dirname } from "node:path";
import { createAdapterRegistry } from "../../lib/workspace-adapters/src/index.js";
import { importsAgentsMd, riskRules, type DoctorJson } from "../../lib/workspace-core/src/index.js";
import type { CensusManifest } from "./manifest.js";
import type { CensusResult } from "./result.js";

export const STATS_SCHEMA_VERSION = 1;

type Artifact = DoctorJson["artifacts"][number];
type Document = DoctorJson["drift"]["documents"][number];
type Block = DoctorJson["drift"]["pairs"][number]["onlyInA"][number];

const MANAGERS = "third-party-managers";

/** Agents in the per-agent table: every adapter but the managers and `agentsmd`, which sees AGENTS.md alone. */
const AGENTS = createAdapterRegistry()
  .list()
  .filter((name) => name !== MANAGERS && name !== "agentsmd");

/** Where an agent's own configuration lives: the coverage matrix's columns. */
export const SURFACES = ["instructions", "mcp", "skills", "commands", "settings"] as const;
export type Surface = (typeof SURFACES)[number];

const SURFACE_OF_KIND: Readonly<Record<string, Surface>> = {
  instructions: "instructions",
  rule: "instructions",
  "mcp-config": "mcp",
  skill: "skills",
  command: "commands",
  subagent: "commands",
  agent: "commands",
  workflow: "commands",
  mode: "commands",
  modes: "commands",
  settings: "settings",
  config: "settings",
  hooks: "settings",
  execpolicy: "settings",
  ignore: "settings",
  plugin: "settings",
  "plugin-manifest": "settings",
  marketplace: "settings",
  theme: "settings",
};

/**
 * How a root instruction file relates to AGENTS.md:
 * - `symlink`: one links to the other, or both to one file; zero drift
 * - `import`: an `@AGENTS.md` line in a file whose agent expands imports pulls AGENTS.md in
 * - `identical`: a separate file with the same content
 * - `diverged`: shares some content with AGENTS.md, differs in the rest
 * - `pointer`: shares nothing, and the shorter file, at most three blocks, names the other
 * - `separate`: shares nothing otherwise, a document of its own
 * - `unreadable`: a broken symlink, or content doctor could not read
 */
export const RELATIONS = ["symlink", "import", "identical", "diverged", "pointer", "separate", "unreadable"] as const;
export type Relation = (typeof RELATIONS)[number];
const POINTER_MAX_BLOCKS = 3;

/**
 * Root instruction files whose agents expand `@path` imports: Claude Code
 * and Gemini/Antigravity. Elsewhere an `@AGENTS.md` line is text the model
 * may or may not follow, which makes it a pointer.
 */
const IMPORTING_FILES: ReadonlySet<string> = new Set(["CLAUDE.md", "GEMINI.md"]);

const AGENT_COUNTS = ["0", "1", "2", "3", "4+"] as const;
const SCORE_BUCKETS = [
  ["100", 100],
  ["90-99", 90],
  ["75-89", 75],
  ["50-74", 50],
  ["0-49", 0],
] as const;

export interface CensusStats {
  schemaVersion: typeof STATS_SCHEMA_VERSION;
  edition: CensusManifest["selection"] & { discoveredOn: string; gitmeshVersion: string };
  repositories: { selected: number; scanned: number; unavailable: number; failed: number };
  agents: {
    /** Repositories with any agent-specific file, shared files included. */
    withOwnConfig: number;
    /** Repositories by how many agents have configuration of their own. */
    perRepository: Record<(typeof AGENT_COUNTS)[number], number>;
    /** Per agent: repositories where it has configuration of its own, in all and per surface. */
    byAgent: Record<string, Record<"repositories" | Surface, number>>;
    /** Repositories with each file that several agents read. */
    sharedFiles: Record<string, number>;
  };
  instructions: {
    /** Repositories with AGENTS.md files in subdirectories. */
    nestedAgentsMd: number;
    /** Repositories with a root instruction file besides AGENTS.md. */
    withAnotherRootFile: number;
    /** Repositories where at least one of those files is a diverged copy of AGENTS.md. */
    withDivergedCopy: number;
    /** Per root instruction file: repositories with it, in all and per relation to AGENTS.md. */
    rootFiles: Record<string, Record<"repositories" | Relation, number>>;
  };
  /** Doctor's own drift report: repositories where it compared root documents, and where any pair differed. */
  drift: { compared: number; drifting: number };
  mcp: { repositories: number; severalAgents: number };
  skills: {
    repositories: number;
    severalAgents: number;
    /** Repositories with a skill of one name in more than one agent's skills directory. */
    sameSkillSeveralAgents: number;
    /** Of those, repositories where at least two of the directories hold their own copy, not a symlink. */
    sameSkillCopied: number;
  };
  /** Repositories with files labeled managed by each third-party manager. */
  managers: Record<string, number>;
  findings: Record<string, { severity: string; repositories: number; findings: number }>;
  scores: { median: number; buckets: Record<(typeof SCORE_BUCKETS)[number][0], number> };
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `record` with keys in code-point order, so output never depends on input order. */
function sorted<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => compare(a, b)));
}

const zeros = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

const repositoryTier = (artifact: Artifact): boolean => artifact.scope === "project" || artifact.scope === "local";
const isAgentsMd = (path: string): boolean => path === "AGENTS.md" || path.endsWith("/AGENTS.md");

function surfaceOf(kind: string): Surface {
  const surface = SURFACE_OF_KIND[kind];
  if (surface === undefined) {
    throw new Error(`doctor reported artifact kind "${kind}", which the census does not map; add it to SURFACE_OF_KIND`);
  }
  return surface;
}

/** Agent-specific files in one report: each agent's own surfaces, and files several agents share. */
function ownConfiguration(report: DoctorJson) {
  const artifacts = report.artifacts.filter(
    (artifact) => repositoryTier(artifact) && artifact.adapter !== MANAGERS && !isAgentsMd(artifact.path),
  );
  const claimants = new Map<string, Set<string>>();
  for (const { path, adapter } of artifacts) {
    claimants.set(path, (claimants.get(path) ?? new Set()).add(adapter));
  }
  const agents = new Map<string, Set<Surface>>();
  const shared = new Set<string>();
  for (const { path, adapter, kind } of artifacts) {
    if (claimants.get(path)!.size > 1) shared.add(path);
    else agents.set(adapter, (agents.get(adapter) ?? new Set()).add(surfaceOf(kind)));
  }
  return { any: artifacts.length > 0, agents, shared };
}

/** Root documents doctor diffs; mirrors `isDriftDocument` in cli/src/workspace/doctor.ts. */
const NESTED_ROOT_DOCUMENTS: ReadonlySet<string> = new Set([".github/copilot-instructions.md"]);
const isRootInstructionFile = ({ scope, kind, path }: Artifact): boolean =>
  scope === "project" && (kind === "instructions" || kind === "rule") && (!path.includes("/") || NESTED_ROOT_DOCUMENTS.has(path));

const names = (blocks: readonly Block[], file: string): boolean =>
  blocks.some((block) => block.text.toLowerCase().includes(file.toLowerCase()));

/** How root instruction file `path` relates to `agentsMd`, the document holding AGENTS.md. */
function relationToAgentsMd(report: DoctorJson, path: string, agentsMd: Document | undefined): Relation {
  const { documents, pairs } = report.drift;
  if (agentsMd === undefined || report.artifacts.some((artifact) => artifact.path === path && artifact.broken)) {
    return "unreadable";
  }
  const document = documents.find((candidate) => candidate.paths.includes(path));
  // Doctor leaves exactly one readable root document out of its diff: the CLAUDE.md that imports AGENTS.md.
  if (document === undefined) return path === "CLAUDE.md" ? "import" : "unreadable";
  if (document.label === agentsMd.label) return "symlink";
  const pair = pairs.find(
    ({ a, b }) => (a === document.label && b === agentsMd.label) || (a === agentsMd.label && b === document.label),
  );
  if (pair === undefined) throw new Error(`doctor did not compare ${path} with AGENTS.md`);
  if (pair.identical) return "identical";
  if (pair.sharedCount > 0) return "diverged";
  const [own, agents] = pair.a === document.label ? [pair.onlyInA, pair.onlyInB] : [pair.onlyInB, pair.onlyInA];
  if (IMPORTING_FILES.has(path) && importsAgentsMd(own.map((block) => block.text).join("\n"))) return "import";
  if (Math.min(document.blocks, agentsMd.blocks) > POINTER_MAX_BLOCKS) return "separate";
  const pointing = document.blocks <= agentsMd.blocks ? names(own, "AGENTS.md") : names(agents, basename(path));
  return pointing ? "pointer" : "separate";
}

/** How each root instruction file besides AGENTS.md relates to AGENTS.md. */
function rootFileRelations(report: DoctorJson): Map<string, Relation> {
  const agentsMd = report.drift.documents.find((document) => document.paths.includes("AGENTS.md"));
  const paths = new Set(report.artifacts.filter(isRootInstructionFile).map(({ path }) => path));
  paths.delete("AGENTS.md");
  return new Map([...paths].map((path) => [path, relationToAgentsMd(report, path, agentsMd)]));
}

interface SkillCopies {
  /** Agents shipping a skill of this name. */
  agents: Set<string>;
  /** Agents whose copy is a file of its own: neither it nor a directory above it is a symlink. */
  ownCopies: Set<string>;
}

/** Skill name (`<dir>/SKILL.md` names it `dir`) → who ships it, and as what. */
function skillsByName(report: DoctorJson): Map<string, SkillCopies> {
  // The symlink scan reports linked entries inside agent config directories, `.claude/skills` included.
  const links = new Set(report.artifacts.filter((artifact) => artifact.symlinkTarget !== undefined).map(({ path }) => path));
  const linked = (path: string): boolean => {
    const parts = path.split("/");
    return parts.some((_, i) => links.has(parts.slice(0, i + 1).join("/")));
  };
  const skills = new Map<string, SkillCopies>();
  for (const artifact of report.artifacts) {
    if (artifact.kind !== "skill" || !repositoryTier(artifact)) continue;
    const { path, adapter } = artifact;
    const name = basename(path) === "SKILL.md" ? basename(dirname(path)) : basename(path).replace(/\.[^.]*$/, "");
    const copies = skills.get(name) ?? { agents: new Set<string>(), ownCopies: new Set<string>() };
    copies.agents.add(adapter);
    if (!linked(path)) copies.ownCopies.add(adapter);
    skills.set(name, copies);
  }
  return skills;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

const increment = (record: Record<string, number>, key: string): void => {
  record[key] = (record[key] ?? 0) + 1;
};

function countAgents({ agents }: CensusStats, report: DoctorJson): void {
  const own = ownConfiguration(report);
  if (own.any) agents.withOwnConfig += 1;
  agents.perRepository[AGENT_COUNTS[Math.min(own.agents.size, AGENT_COUNTS.length - 1)]!] += 1;
  for (const [agent, surfaces] of own.agents) {
    const row = (agents.byAgent[agent] ??= zeros(["repositories", ...SURFACES] as const));
    row.repositories += 1;
    for (const surface of surfaces) row[surface] += 1;
  }
  for (const path of own.shared) increment(agents.sharedFiles, path);
}

function countInstructions({ instructions, drift }: CensusStats, report: DoctorJson): void {
  if (report.artifacts.some(({ scope, path }) => scope === "project" && path.endsWith("/AGENTS.md"))) {
    instructions.nestedAgentsMd += 1;
  }
  const relations = rootFileRelations(report);
  if (relations.size > 0) instructions.withAnotherRootFile += 1;
  if ([...relations.values()].includes("diverged")) instructions.withDivergedCopy += 1;
  for (const [path, relation] of relations) {
    const row = (instructions.rootFiles[path] ??= zeros(["repositories", ...RELATIONS] as const));
    row.repositories += 1;
    row[relation] += 1;
  }
  if (report.drift.pairs.length > 0) drift.compared += 1;
  if (report.summary.driftingPairs > 0) drift.drifting += 1;
}

function countMcpAndSkills({ mcp, skills }: CensusStats, report: DoctorJson): void {
  const mcpAgents = new Set(
    report.artifacts.filter((artifact) => repositoryTier(artifact) && artifact.kind === "mcp-config").map(({ adapter }) => adapter),
  );
  if (mcpAgents.size > 0) mcp.repositories += 1;
  if (mcpAgents.size > 1) mcp.severalAgents += 1;
  const byName = [...skillsByName(report).values()];
  const skillAgents = new Set(byName.flatMap(({ agents }) => [...agents]));
  if (skillAgents.size > 0) skills.repositories += 1;
  if (skillAgents.size > 1) skills.severalAgents += 1;
  if (byName.some(({ agents }) => agents.size > 1)) skills.sameSkillSeveralAgents += 1;
  if (byName.some(({ ownCopies }) => ownCopies.size > 1)) skills.sameSkillCopied += 1;
}

function countFindings({ managers, findings, scores }: CensusStats, report: DoctorJson): void {
  for (const manager of new Set(report.artifacts.flatMap(({ manager }) => (manager ? [manager] : [])))) {
    increment(managers, manager);
  }
  for (const { ruleId, severity } of report.findings) {
    (findings[ruleId] ??= { severity, repositories: 0, findings: 0 }).findings += 1;
  }
  for (const ruleId of new Set(report.findings.map((finding) => finding.ruleId))) {
    findings[ruleId]!.repositories += 1;
  }
  const [label] = SCORE_BUCKETS.find(([, floor]) => report.summary.score >= floor)!;
  scores.buckets[label] += 1;
}

export function aggregate(manifest: CensusManifest, results: readonly CensusResult[]): CensusStats {
  const reports = results.flatMap((result) => (result.status === "ok" && result.doctor ? [result.doctor] : []));
  const unavailable = results.filter((result) => result.status === "unavailable").length;
  const stats: CensusStats = {
    schemaVersion: STATS_SCHEMA_VERSION,
    edition: {
      ...manifest.selection,
      discoveredOn: manifest.discoveredOn,
      gitmeshVersion: results[0]?.gitmeshVersion ?? "",
    },
    repositories: {
      selected: manifest.repositories.length,
      scanned: reports.length,
      unavailable,
      failed: results.length - reports.length - unavailable,
    },
    agents: {
      withOwnConfig: 0,
      perRepository: zeros(AGENT_COUNTS),
      byAgent: Object.fromEntries(AGENTS.map((agent) => [agent, zeros(["repositories", ...SURFACES] as const)])),
      sharedFiles: {},
    },
    instructions: { nestedAgentsMd: 0, withAnotherRootFile: 0, withDivergedCopy: 0, rootFiles: {} },
    drift: { compared: 0, drifting: 0 },
    mcp: { repositories: 0, severalAgents: 0 },
    skills: { repositories: 0, severalAgents: 0, sameSkillSeveralAgents: 0, sameSkillCopied: 0 },
    managers: {},
    findings: Object.fromEntries(
      riskRules.map(({ id, severity }) => [id, { severity, repositories: 0, findings: 0 }]),
    ),
    scores: {
      median: median(reports.map((report) => report.summary.score)),
      buckets: zeros(SCORE_BUCKETS.map(([label]) => label)),
    },
  };
  for (const report of reports) {
    countAgents(stats, report);
    countInstructions(stats, report);
    countMcpAndSkills(stats, report);
    countFindings(stats, report);
  }
  stats.agents.byAgent = sorted(stats.agents.byAgent);
  stats.agents.sharedFiles = sorted(stats.agents.sharedFiles);
  stats.instructions.rootFiles = sorted(stats.instructions.rootFiles);
  stats.managers = sorted(stats.managers);
  stats.findings = sorted(stats.findings);
  return stats;
}

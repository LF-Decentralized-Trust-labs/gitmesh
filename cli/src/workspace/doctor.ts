/**
 * `gitmesh doctor` (pivot §8.1 item 4, T1.17): detectors → file content →
 * drift differ (T1.9) → GM rule table (T1.10) → one renderer (T1.16), then
 * exit 0 clean / 1 findings at or above `--fail-on` / 2 errors. Read-only
 * by construction - no writes, no network, no subprocess (ADR-002); the
 * spies in `__tests__/doctor.test.ts` hold it to that.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Command } from "commander";
import {
  createAdapterRegistry,
  type DetectedArtifact,
  type RepoContext,
} from "@gitmesh/workspace-adapters";
import {
  computeDriftReport,
  renderDoctorJson,
  renderDoctorMarkdown,
  renderDoctorTty,
  resolveLogicalPath,
  riskRules,
  runRiskRules,
  type DoctorArtifact,
  type DoctorReport,
  type DriftDocumentInput,
  type RiskSeverity,
} from "@gitmesh/workspace-core";

/** `--fail-on` levels: the lowest severity that fails the run, or never. */
export const FAIL_ON_LEVELS = ["error", "warning", "info", "none"] as const;
export type FailOn = (typeof FAIL_ON_LEVELS)[number];
const RANK: Record<RiskSeverity, number> = { info: 0, warning: 1, error: 2 };

export interface DoctorOptions {
  /** Directory to audit; its enclosing git root is scanned. Default: cwd. */
  dir?: string;
  json?: boolean;
  md?: boolean;
  /** Default `warning`: informational findings never fail a run. */
  failOn?: string;
  /** Include user-scope artifacts (`RepoContext.userScope`). */
  user?: boolean;
  color?: boolean;
}

export interface DoctorResult {
  report: DoctorReport;
  output: string;
  exitCode: 0 | 1;
}

/** Nearest ancestor holding a `.git` entry (directory, or file for worktrees); `dir` itself when none. */
export function findRepoRoot(dir: string): string {
  for (let current = dir; ; current = dirname(current)) {
    if (existsSync(join(current, ".git"))) return current;
    if (dirname(current) === current) return dir;
  }
}

/** Absolute location of an artifact's content; managed probes and env hints have none. */
function locate(artifact: DetectedArtifact, root: string, home: string): string | undefined {
  if (artifact.broken) return undefined;
  if (artifact.scope === "project" || artifact.scope === "local") return join(root, artifact.path);
  if (artifact.scope === "user" && artifact.path.startsWith("~/")) {
    return join(home, artifact.path.slice(2));
  }
  return undefined;
}

/** Root-anchored instruction documents; nested per-directory files are context, not cross-tool copies. */
function isDriftDocument({ scope, kind, path }: DetectedArtifact): boolean {
  return (
    scope === "project" &&
    (kind === "instructions" || kind === "rule") &&
    (!path.includes("/") || path.startsWith("."))
  );
}

function readText(abs: string): string | undefined {
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return undefined;
  }
}

/** Runs every registered detector over `repo` and assembles the report. */
export async function collectDoctorReport(repo: RepoContext): Promise<DoctorReport> {
  const registry = createAdapterRegistry();
  const home = repo.homeDir ?? homedir();
  const contents = new Map<string, string | undefined>();
  const artifacts: DoctorArtifact[] = [];
  const documents = new Map<string, DriftDocumentInput>();
  for (const name of registry.list()) {
    for (const detected of (await registry.load(name)).detect(repo)) {
      const { path, kind, scope, executable, symlinkTarget, broken } = detected;
      const { manager } = detected as { manager?: string };
      const artifact: DoctorArtifact = {
        adapter: name,
        path,
        kind,
        scope,
        executable,
        symlinkTarget,
        broken,
        manager,
      };
      const abs = locate(detected, repo.rootDir, home);
      if (abs !== undefined) {
        if (!contents.has(abs)) contents.set(abs, readText(abs));
        artifact.content = contents.get(abs);
        if (artifact.content !== undefined && isDriftDocument(detected) && !documents.has(path)) {
          documents.set(path, {
            path,
            content: artifact.content,
            logicalPath: resolveLogicalPath(abs),
          });
        }
      }
      artifacts.push(artifact);
    }
  }
  return {
    artifacts,
    drift: computeDriftReport([...documents.values()]),
    findings: runRiskRules({ artifacts }, riskRules),
  };
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isFailOn(value: string): value is FailOn {
  return (FAIL_ON_LEVELS as readonly string[]).includes(value);
}

/** The whole command minus process I/O; throws on usage or run errors (exit 2). */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const dir = resolve(options.dir ?? ".");
  if (!isDirectory(dir)) throw new Error(`${dir} is not a directory`);
  const failOn = options.failOn ?? "warning";
  if (!isFailOn(failOn)) {
    throw new Error(`--fail-on must be one of ${FAIL_ON_LEVELS.join(", ")}, got "${failOn}"`);
  }
  if (options.json && options.md) throw new Error("--json and --md are mutually exclusive");

  const repo: RepoContext = { rootDir: findRepoRoot(dir) };
  if (options.user) repo.userScope = true;
  const report = await collectDoctorReport(repo);
  const output = options.json
    ? renderDoctorJson(report)
    : options.md
      ? renderDoctorMarkdown(report)
      : renderDoctorTty(report, { color: options.color });
  const failed =
    failOn !== "none" &&
    report.findings.some((finding) => RANK[finding.severity] >= RANK[failOn]);
  return { report, output, exitCode: failed ? 1 : 0 };
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Audit agent configuration across coding agents")
    .argument("[dir]", "directory to audit; its git root is scanned (default: cwd)")
    .option("--json", "machine-readable report (schemaVersion 1)")
    .option("--md", "Markdown report for PR comments")
    .option("--fail-on <severity>", `exit 1 at or above: ${FAIL_ON_LEVELS.join(" | ")}`, "warning")
    .option("--user", "include user-scope artifacts from the home directory")
    .action(async (dir: string | undefined, opts: DoctorOptions, cmd: Command) => {
      let result: DoctorResult;
      try {
        result = await runDoctor({
          ...opts,
          dir,
          color: process.stdout.isTTY && !process.env.NO_COLOR,
        });
      } catch (err) {
        cmd.error(`gitmesh doctor: ${err instanceof Error ? err.message : String(err)}`, {
          exitCode: 2,
        });
      }
      process.stdout.write(result.output);
      process.exitCode = result.exitCode;
    });
}

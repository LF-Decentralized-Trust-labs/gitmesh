/**
 * `gitmesh doctor` (pivot §8.1 item 4, T1.17): detectors → file content →
 * drift differ (T1.9) → GM rule table (T1.10) → one renderer (T1.16), then
 * exit 0 clean / 1 findings at or above `--fail-on` / 2 errors. Read-only
 * by construction - no writes, no network, no subprocess (ADR-002); the
 * spies in `__tests__/doctor.test.ts` hold it to that.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import {
  createAdapterRegistry,
  type DetectedArtifact,
  type RepoContext,
} from "@gitmesh/workspace-adapters";
import { safeStat } from "@gitmesh/workspace-adapters/detect-fs";
import {
  computeDriftReport,
  importsAgentsMd,
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
  /**
   * `RepoContext` overlay for the machine-scoped probes (`env`,
   * `managedSettingsPaths`, `requirementsTomlPaths`,
   * `antigravitySettingsPaths`, `homeDir`). Not a CLI flag - the command
   * never sets it. Tests pin these so a run is reproducible off the machine
   * that happens to have a Codex install or org-managed settings.
   */
  context?: Partial<RepoContext>;
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

/**
 * Absolute location of an artifact's content; managed probes and env hints
 * have none. User-scope display paths come in two shapes: the `~/` prefix,
 * and the `$VAR/` prefix a detector emits when an environment variable is
 * what located the file (codex writes `$CODEX_HOME/config.toml`). Both
 * resolve here, so whether a rule gets to inspect a file never depends on
 * how the detector chose to label it.
 */
function locate(
  artifact: DetectedArtifact,
  root: string,
  home: string,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (artifact.broken) return undefined;
  if (artifact.scope === "project" || artifact.scope === "local") return join(root, artifact.path);
  if (artifact.scope !== "user") return undefined;
  if (artifact.path.startsWith("~/")) return join(home, artifact.path.slice(2));
  const [head, ...rest] = artifact.path.split("/");
  if (head !== undefined && head.startsWith("$") && rest.length > 0) {
    // An unset *or empty* variable has no location: `join("", "config.toml")`
    // would be a relative path, i.e. a read against the current directory.
    const base = env[head.slice(1)];
    return base ? join(base, ...rest) : undefined;
  }
  return undefined;
}

/**
 * Not every instruction file is a copy of the same document. Each agent
 * reads one instruction document at the repo root - AGENTS.md, CLAUDE.md,
 * GEMINI.md, .cursorrules, .clinerules, .windsurfrules - and those are the
 * cross-tool copies drift is about. The per-topic trees (.cursor/rules/,
 * .claude/rules/, .github/instructions/, .roo/rules/, .devin/rules/) are
 * scoped by their own globs, and nested packages/<pkg>/AGENTS.md is context
 * for one directory; pairing any of them would diff unrelated documents
 * against each other, O(n^2) of them, and charge the score for every pair.
 */
const NESTED_ROOT_DOCUMENTS: ReadonlySet<string> = new Set([".github/copilot-instructions.md"]);

function isDriftDocument({ scope, kind, path }: DetectedArtifact): boolean {
  return (
    scope === "project" &&
    (kind === "instructions" || kind === "rule") &&
    (!path.includes("/") || NESTED_ROOT_DOCUMENTS.has(path))
  );
}

/**
 * A CLAUDE.md carrying the `@AGENTS.md` import token is the #6235 shim
 * GM010 recommends (pivot §8.2): a pointer to AGENTS.md plus Claude-only
 * extras, not an independent copy - so it stays out of the pairwise differ,
 * the same reasoning that makes a symlinked CLAUDE.md zero drift (§10.4).
 * Diffing the shim charged the score for adopting doctor's own remediation.
 * Resolving the import and diffing the merged document is the normalizer's
 * lane (E3) and can supersede this exclusion.
 */
function isAgentsMdShim(path: string, content: string): boolean {
  return path === "CLAUDE.md" && importsAgentsMd(content);
}

/**
 * File content, or `undefined` when there is nothing to read: a presence
 * probe, or a path that vanished mid-run. A file we are not *allowed* to
 * open is a different thing entirely - every content rule reads `undefined`
 * as "nothing to report", so returning it there would let doctor certify a
 * file it never saw. That aborts the run instead (exit 2).
 */
function readText(abs: string, display: string): string | undefined {
  try {
    return readFileSync(abs, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      throw new Error(`cannot read ${display} (${code}); fix its permissions or exclude it`);
    }
    return undefined;
  }
}

/** Runs every registered detector over `repo` and assembles the report. */
export async function collectDoctorReport(repo: RepoContext): Promise<DoctorReport> {
  const registry = createAdapterRegistry();
  const home = repo.homeDir ?? homedir();
  const env = repo.env ?? process.env;
  const contents = new Map<string, string | undefined>();
  const artifacts: DoctorArtifact[] = [];
  const documents = new Map<string, DriftDocumentInput>();
  for (const name of registry.list()) {
    for (const detected of (await registry.load(name)).detect(repo)) {
      const { path, kind, scope, executable, symlinkTarget, broken, manager } = detected;
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
      const abs = locate(detected, repo.rootDir, home, env);
      if (abs !== undefined) {
        if (!contents.has(abs)) contents.set(abs, readText(abs, path));
        artifact.content = contents.get(abs);
        if (
          artifact.content !== undefined &&
          isDriftDocument(detected) &&
          !isAgentsMdShim(path, artifact.content) &&
          !documents.has(path)
        ) {
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

const isDirectory = (dir: string): boolean => safeStat(dir)?.isDirectory() ?? false;

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

  const repo: RepoContext = { ...options.context, rootDir: findRepoRoot(dir) };
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
      try {
        // `pc.isColorSupported` is what every other gitmesh command honors
        // (NO_COLOR, FORCE_COLOR, --no-color, TERM=dumb, CI), so doctor does
        // not get a second, quietly different answer.
        const { output, exitCode } = await runDoctor({ ...opts, dir, color: pc.isColorSupported });
        process.stdout.write(output);
        process.exitCode = exitCode;
      } catch (err) {
        cmd.error(`gitmesh doctor: ${err instanceof Error ? err.message : String(err)}`, {
          exitCode: 2,
        });
      }
    });
}

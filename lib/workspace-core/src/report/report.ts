/**
 * Doctor report model, score and shared formatting (pivot.md §8.1 item 4,
 * T1.16).
 *
 * `DoctorReport` is what one `gitmesh doctor` run assembles before any
 * output: the inventory (detector artifacts with adapter provenance and
 * pre-read content - the risk engine's own input, plus the T1.7 manager
 * label), the T1.9 drift report and the T1.10 findings. The three renderers
 * (`tty`, `json`, `markdown`) turn it into text. Pure data → string: no
 * filesystem, no wallclock, deterministic ordering, and artifact `content`
 * never reaches any output mode (hard rule 5); drift block text passes
 * through GM001's scanner first, so a token pasted into an instruction
 * file is redacted in every mode too.
 *
 * Score: 100 minus 20 per error, 5 per warning, 5 per pair of instruction
 * documents that differ; `info` findings never cost points. Clamped at 0.
 */

import type { DriftBlockRef, DriftReport, PairDrift } from "../drift/index.js";
import { scanForSecrets } from "../risk/gm001.js";
import type { RiskArtifact, RiskFinding, RiskSeverity } from "../risk/index.js";

/** An inventoried artifact plus its third-party manager, when one owns it. */
export interface DoctorArtifact extends RiskArtifact {
  /** Manager reported by the T1.7 detector, e.g. `"ruler"`; informational. */
  manager?: string;
}

/** Everything one `gitmesh doctor` run produces, before rendering. */
export interface DoctorReport {
  artifacts: readonly DoctorArtifact[];
  drift: DriftReport;
  findings: readonly RiskFinding[];
}

/** Headline numbers every renderer prints. */
export interface DoctorSummary {
  /** 0–100 health score. */
  score: number;
  artifacts: number;
  adapters: number;
  findings: Record<RiskSeverity, number>;
  driftingPairs: number;
}

/** Severities in display order: most severe first. */
export const SEVERITIES: readonly RiskSeverity[] = ["error", "warning", "info"];

const PENALTY: Record<RiskSeverity, number> = { error: 20, warning: 5, info: 0 };
const DRIFT_PENALTY = 5;

export function summarizeDoctorReport(report: DoctorReport): DoctorSummary {
  const findings: Record<RiskSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const finding of report.findings) findings[finding.severity] += 1;
  const driftingPairs = report.drift.pairs.filter((pair) => !pair.identical).length;
  const penalty =
    SEVERITIES.reduce((sum, severity) => sum + findings[severity] * PENALTY[severity], 0) +
    driftingPairs * DRIFT_PENALTY;
  return {
    score: Math.max(0, 100 - penalty),
    artifacts: report.artifacts.length,
    adapters: new Set(report.artifacts.map((artifact) => artifact.adapter)).size,
    findings,
    driftingPairs,
  };
}

/** Artifacts grouped by adapter; adapters and paths in code-point order. */
export function groupArtifacts(
  report: DoctorReport,
): Array<[adapter: string, artifacts: DoctorArtifact[]]> {
  const groups = new Map<string, DoctorArtifact[]>();
  for (const artifact of report.artifacts) {
    const list = groups.get(artifact.adapter);
    if (list) list.push(artifact);
    else groups.set(artifact.adapter, [artifact]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([adapter, list]) => [adapter, list.sort((a, b) => compareStrings(a.path, b.path))]);
}

/** Informational annotations shown after an artifact's path and kind. */
export function artifactNotes(artifact: DoctorArtifact): string[] {
  const notes: string[] = [];
  if (artifact.scope !== "project") notes.push(artifact.scope);
  if (artifact.symlinkTarget !== undefined) notes.push(`symlink -> ${artifact.symlinkTarget}`);
  if (artifact.broken) notes.push("broken");
  if (artifact.manager !== undefined) notes.push(`managed by ${artifact.manager}`);
  return notes;
}

/** Findings of one severity, in engine order (rule id, path, adapter, message). */
export function findingsOf(report: DoctorReport, severity: RiskSeverity): RiskFinding[] {
  return report.findings.filter((finding) => finding.severity === severity);
}

/** `path (adapter)`, either part optional; empty for workspace-wide findings. */
export function findingLocation(finding: RiskFinding): string {
  return [finding.path, finding.adapter && `(${finding.adapter})`].filter(Boolean).join(" ");
}

/** One-line result of a document pair, e.g. `2 blocks only in A, 3 shared`. */
export function describePair(pair: PairDrift): string {
  if (pair.identical) return "identical";
  const parts: string[] = [];
  if (pair.onlyInA.length) parts.push(`${plural(pair.onlyInA.length, "block")} only in ${pair.a}`);
  if (pair.onlyInB.length) parts.push(`${plural(pair.onlyInB.length, "block")} only in ${pair.b}`);
  if (pair.reordered.length) parts.push(`${pair.reordered.length} reordered`);
  parts.push(`${pair.sharedCount} shared`);
  return parts.join(", ");
}

/** First line of a block, at most 60 characters, `...` when cut. */
export function blockPreview(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  const cut = firstLine.length > 60 || firstLine.length < text.length;
  return `${firstLine.slice(0, 60)}${cut ? "..." : ""}`;
}

/** A block safe to print: lines GM001 flags are replaced; the hash still identifies it. */
export function redactBlock(block: DriftBlockRef): DriftBlockRef {
  const hits = scanForSecrets(block.text);
  if (hits.length === 0) return block;
  const lines = block.text.split("\n");
  for (const { line, reason } of hits) lines[line - 1] = `[redacted ${reason}]`;
  return { kind: block.kind, text: lines.join("\n"), hash: block.hash };
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** `1 error, 2 warnings, 1 info` (info has no plural). */
export function describeFindingCounts(summary: DoctorSummary): string {
  return SEVERITIES.map((severity) =>
    severity === "info" ? `${summary.findings.info} info` : plural(summary.findings[severity], severity),
  ).join(", ");
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

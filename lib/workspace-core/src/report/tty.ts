/**
 * Human TTY renderer: inventory grouped by adapter, drift per document
 * pair, findings grouped by severity, 0–100 score last so it is what the
 * user sees after a long report scrolls. Colors are opt-in ANSI so piped
 * output and snapshots stay clean by default.
 */

import type { RiskSeverity } from "../risk/index.js";
import {
  artifactNotes,
  blockPreview,
  describeFindingCounts,
  describePair,
  findingLocation,
  findingsOf,
  groupArtifacts,
  plural,
  redactBlock,
  SEVERITIES,
  summarizeDoctorReport,
  type DoctorReport,
} from "./report.js";

export interface DoctorTtyOptions {
  /** Emit ANSI colors; off by default. The CLI enables it for a real TTY. */
  color?: boolean;
}

type Paint = (text: string) => string;
type Palette = Record<"bold" | "dim" | "red" | "yellow" | "green" | "cyan", Paint>;

const ESC = String.fromCharCode(27);
const ansi =
  (code: number): Paint =>
  (text) =>
    `${ESC}[${code}m${text}${ESC}[0m`;
const plain: Paint = (text) => text;

const COLOR: Palette = {
  bold: ansi(1),
  dim: ansi(2),
  red: ansi(31),
  green: ansi(32),
  yellow: ansi(33),
  cyan: ansi(36),
};
const PLAIN: Palette = { bold: plain, dim: plain, red: plain, green: plain, yellow: plain, cyan: plain };

const SEVERITY_COLOR: Record<RiskSeverity, keyof Palette> = {
  error: "red",
  warning: "yellow",
  info: "cyan",
};

export function renderDoctorTty(report: DoctorReport, options: DoctorTtyOptions = {}): string {
  const p = options.color ? COLOR : PLAIN;
  const summary = summarizeDoctorReport(report);
  const lines: string[] = [p.bold("gitmesh doctor"), ""];

  lines.push(
    p.bold(`Inventory (${plural(summary.artifacts, "artifact")}, ${plural(summary.adapters, "adapter")})`),
  );
  if (summary.artifacts === 0) lines.push(p.dim("  no agent artifacts found"));
  for (const [adapter, artifacts] of groupArtifacts(report)) {
    lines.push(`  ${p.cyan(adapter)}`);
    const pathWidth = Math.max(...artifacts.map((artifact) => artifact.path.length));
    const kindWidth = Math.max(...artifacts.map((artifact) => artifact.kind.length));
    for (const artifact of artifacts) {
      const notes = artifactNotes(artifact).join(", ");
      lines.push(
        `    ${artifact.path.padEnd(pathWidth)}  ${p.dim(artifact.kind.padEnd(kindWidth))}` +
          (notes ? `  ${p.dim(notes)}` : ""),
      );
    }
  }
  lines.push("");

  const { drift } = report;
  lines.push(
    p.bold(
      `Drift (${plural(drift.documents.length, "instruction document")}, ` +
        `${plural(summary.driftingPairs, "divergent pair")})`,
    ),
  );
  if (drift.pairs.length === 0 && drift.symlinkGroups.length === 0) {
    lines.push(p.dim("  fewer than two instruction documents, nothing to compare"));
  }
  for (const group of drift.symlinkGroups) {
    lines.push(`  ${group.join(" = ")}  ${p.green("symlink group, zero drift")}`);
  }
  for (const pair of drift.pairs) {
    const result = pair.identical ? p.green("identical") : p.yellow(describePair(pair));
    lines.push(`  ${pair.a} vs ${pair.b}  ${result}`);
  }
  if (drift.divergentBlocks.length > 0) {
    lines.push("  divergent blocks");
    for (const { block, presentIn, missingFrom } of drift.divergentBlocks) {
      lines.push(
        `    ${JSON.stringify(blockPreview(redactBlock(block).text))}  ` +
          p.dim(`in ${presentIn.join(", ")}; missing from ${missingFrom.join(", ")}`),
      );
    }
  }
  lines.push("");

  lines.push(
    p.bold(`Findings (${report.findings.length === 0 ? "none" : describeFindingCounts(summary)})`),
  );
  if (report.findings.length === 0) lines.push(p.green("  no findings"));
  for (const severity of SEVERITIES) {
    const group = findingsOf(report, severity);
    if (group.length === 0) continue;
    lines.push(`  ${p[SEVERITY_COLOR[severity]](severity)}`);
    const width = Math.max(...group.map((finding) => findingLocation(finding).length));
    for (const finding of group) {
      const location = width > 0 ? `${findingLocation(finding).padEnd(width)}  ` : "";
      lines.push(`    ${p.bold(finding.ruleId)}  ${location}${finding.message}`);
    }
  }
  lines.push("");

  const scorePaint = summary.score >= 80 ? p.green : summary.score >= 50 ? p.yellow : p.red;
  lines.push(`${p.bold("Score")} ${scorePaint(`${summary.score}/100`)}`);
  return lines.join("\n") + "\n";
}

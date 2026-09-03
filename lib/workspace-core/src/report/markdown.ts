/**
 * `--md` renderer, shaped for a PR comment: score headline, findings table
 * first, drift table, inventory collapsed in `<details>`.
 */

import {
  artifactNotes,
  blockPreview,
  describeFindingCounts,
  describePair,
  findingsOf,
  groupArtifacts,
  plural,
  SEVERITIES,
  summarizeDoctorReport,
  type DoctorReport,
} from "./report.js";

/** Table-cell safe text: no pipes, no line breaks. */
const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const code = (text: string): string => `\`${cell(text)}\``;

export function renderDoctorMarkdown(report: DoctorReport): string {
  const summary = summarizeDoctorReport(report);
  const lines: string[] = [
    `## gitmesh doctor: ${summary.score}/100`,
    "",
    `${plural(summary.artifacts, "artifact")} across ${plural(summary.adapters, "adapter")}. ` +
      `${describeFindingCounts(summary)}. ${plural(summary.driftingPairs, "divergent instruction pair")}.`,
    "",
    "### Findings",
    "",
  ];

  if (report.findings.length === 0) {
    lines.push("No findings.", "");
  } else {
    lines.push("| Severity | Rule | Location | Message |", "| --- | --- | --- | --- |");
    for (const severity of SEVERITIES) {
      for (const finding of findingsOf(report, severity)) {
        const location = [finding.path && code(finding.path), finding.adapter && `(${finding.adapter})`]
          .filter(Boolean)
          .join(" ");
        lines.push(`| ${severity} | ${finding.ruleId} | ${location} | ${cell(finding.message)} |`);
      }
    }
    lines.push("");
  }

  const { drift } = report;
  lines.push("### Drift", "");
  if (drift.pairs.length === 0 && drift.symlinkGroups.length === 0) {
    lines.push("Fewer than two instruction documents, nothing to compare.", "");
  } else {
    lines.push("| Documents | Result |", "| --- | --- |");
    for (const group of drift.symlinkGroups) {
      lines.push(`| ${group.map(code).join(" = ")} | symlink group, zero drift |`);
    }
    for (const pair of drift.pairs) {
      lines.push(`| ${code(pair.a)} vs ${code(pair.b)} | ${cell(describePair(pair))} |`);
    }
    lines.push("");
  }
  if (drift.divergentBlocks.length > 0) {
    lines.push("Divergent blocks:", "");
    for (const { block, presentIn, missingFrom } of drift.divergentBlocks) {
      lines.push(
        `- ${cell(JSON.stringify(blockPreview(block.text)))} in ${presentIn.map(code).join(", ")}; ` +
          `missing from ${missingFrom.map(code).join(", ")}`,
      );
    }
    lines.push("");
  }

  lines.push(
    "<details>",
    `<summary>Inventory (${plural(summary.artifacts, "artifact")}, ${plural(summary.adapters, "adapter")})</summary>`,
    "",
  );
  if (summary.artifacts === 0) {
    lines.push("No agent artifacts found.", "");
  } else {
    lines.push("| Adapter | Path | Kind | Notes |", "| --- | --- | --- | --- |");
    for (const [adapter, artifacts] of groupArtifacts(report)) {
      for (const artifact of artifacts) {
        lines.push(
          `| ${adapter} | ${code(artifact.path)} | ${cell(artifact.kind)} | ${cell(artifactNotes(artifact).join(", "))} |`,
        );
      }
    }
    lines.push("");
  }
  lines.push("</details>");
  return lines.join("\n") + "\n";
}

/**
 * `--json` renderer: the stable, versioned machine-readable schema
 * (consumed later by the check Action and the receipt bundle's
 * `doctor.json`, §10.7). Every object is projected field by field so key
 * order is fixed and nothing outside the schema (notably artifact
 * `content`) can leak into the output.
 */

import type { BlockPresence, PairDrift } from "../drift/index.js";
import type { RiskFinding } from "../risk/index.js";
import {
  groupArtifacts,
  summarizeDoctorReport,
  type DoctorArtifact,
  type DoctorReport,
  type DoctorSummary,
} from "./report.js";

/** Bump when a field changes meaning or disappears; additions are compatible. */
export const DOCTOR_JSON_SCHEMA_VERSION = 1;

export interface DoctorJsonDocument {
  label: string;
  paths: string[];
  blocks: number;
}

export interface DoctorJson {
  schemaVersion: typeof DOCTOR_JSON_SCHEMA_VERSION;
  summary: DoctorSummary;
  /** Sorted by adapter, then path. Exactly these fields; never content. */
  artifacts: Pick<
    DoctorArtifact,
    "adapter" | "path" | "kind" | "scope" | "symlinkTarget" | "broken" | "manager"
  >[];
  drift: {
    documents: DoctorJsonDocument[];
    symlinkGroups: string[][];
    pairs: PairDrift[];
    divergentBlocks: BlockPresence[];
  };
  findings: RiskFinding[];
}

export function renderDoctorJson(report: DoctorReport): string {
  const { drift } = report;
  const json: DoctorJson = {
    schemaVersion: DOCTOR_JSON_SCHEMA_VERSION,
    summary: summarizeDoctorReport(report),
    artifacts: groupArtifacts(report)
      .flatMap(([, artifacts]) => artifacts)
      .map(({ adapter, path, kind, scope, symlinkTarget, broken, manager }) => ({
        adapter,
        path,
        kind,
        scope,
        symlinkTarget,
        broken,
        manager,
      })),
    drift: {
      documents: drift.documents.map(({ label, paths, doc }) => ({
        label,
        paths,
        blocks: doc.blocks.length,
      })),
      symlinkGroups: drift.symlinkGroups,
      pairs: drift.pairs.map(({ a, b, identical, sharedCount, onlyInA, onlyInB, reordered }) => ({
        a,
        b,
        identical,
        sharedCount,
        onlyInA,
        onlyInB,
        reordered,
      })),
      divergentBlocks: drift.divergentBlocks.map(({ block, presentIn, missingFrom }) => ({
        block,
        presentIn,
        missingFrom,
      })),
    },
    findings: report.findings.map(({ ruleId, severity, message, path, adapter }) => ({
      ruleId,
      severity,
      message,
      path,
      adapter,
    })),
  };
  return JSON.stringify(json, null, 2) + "\n";
}

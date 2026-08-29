/**
 * Risk-rule engine (pivot.md §8.1, T1.10).
 *
 * Table-driven: every GM rule is one `RiskRule` entry - a versioned
 * ESLint-style id, a fixed severity, a declarative `appliesTo` filter and a
 * pure `check`. The engine filters the doctor inventory per rule, invokes
 * `check` with the matched subset (plus the full input, for cross-artifact
 * and absence rules), and stamps the rule's id and severity onto every
 * returned finding - rules cannot mislabel their own output.
 *
 * `check` runs for every rule, even when zero artifacts match `appliesTo`:
 * absence is itself a signal (e.g. GM002 "no deny/ask protection", GM010
 * "CLAUDE.md without an AGENTS.md bridge").
 *
 * Pure data → data: no filesystem access, no wallclock; the caller (the
 * doctor pipeline) reads file contents. Findings never include raw artifact
 * content, but rule messages are free-form, so rules MUST redact any secret
 * values they inspect (hard rule 5, §10.1 principle 7).
 * Deterministic: findings sort by rule id, then path, then message,
 * independent of rule table order. Rendering is T1.16's job.
 */

/**
 * Severity of a rule, ascending: info < warning < error. `"info"` =
 * informational (e.g. GM008). The `--fail-on` ordering helper lands with
 * T1.17, its first consumer.
 */
export type RiskSeverity = "info" | "warning" | "error";

/**
 * Configuration tier of an artifact. Mirrors the adapters' `ArtifactScope`
 * literally; core cannot import it (the dependency points the other way).
 */
export type RiskArtifactScope = "managed" | "user" | "project" | "local";

/**
 * One inventoried artifact handed to the engine: a detector result
 * (adapter provenance added by the caller) plus pre-read content.
 */
export interface RiskArtifact {
  /** Adapter that detected the artifact, e.g. `"claude-code"`. */
  adapter: string;
  /** Stable POSIX-style display path (detector output convention). */
  path: string;
  /** Adapter-specific artifact kind, e.g. `"instructions"`. */
  kind: string;
  /** Configuration tier the artifact belongs to. */
  scope: RiskArtifactScope;
  /** Raw content when the caller read it; presence probes carry none. */
  content?: string;
  /** Literal symlink target when the artifact is itself a symlink. */
  symlinkTarget?: string;
  /** True when the artifact is a symlink that does not resolve to a file. */
  broken?: boolean;
}

/** The doctor inventory the engine runs over. */
export interface RiskInput {
  artifacts: readonly RiskArtifact[];
}

/**
 * Declarative filter selecting the artifacts a rule inspects. An omitted
 * field matches everything; listed fields AND together. An empty list
 * matches nothing.
 */
export interface RiskApplicability {
  adapters?: readonly string[];
  kinds?: readonly string[];
  scopes?: readonly RiskArtifactScope[];
}

/**
 * A finding as returned by a rule's `check`. Messages must never embed
 * secret values - name the location, redact the value.
 */
export interface RuleFinding {
  /** Human-readable sentence describing the finding. */
  message: string;
  /** Display path of the artifact concerned, when one exists. */
  path?: string;
  /** Adapter the finding concerns, when one exists. */
  adapter?: string;
}

/** A `RuleFinding` stamped with its rule's identity by the engine. */
export interface RiskFinding extends RuleFinding {
  /** Id of the rule that produced the finding, e.g. `"GM001"`. */
  ruleId: string;
  /** The rule's severity. */
  severity: RiskSeverity;
}

/** Context handed to a rule's `check`. */
export interface RuleContext {
  /** Artifacts matching `appliesTo`, in inventory order. */
  matched: readonly RiskArtifact[];
  /** The full input, for cross-artifact and absence rules. */
  input: RiskInput;
}

/** One entry in the GM rule table (§8.1: versioned, ESLint-style ids). */
export interface RiskRule {
  /** Stable versioned id, e.g. `"GM001"`; unique within a table. */
  id: string;
  /** Severity stamped onto every finding this rule produces. */
  severity: RiskSeverity;
  /** Declarative filter for the artifacts handed to `check`. */
  appliesTo: RiskApplicability;
  /** Pure inspection: matched artifacts in, findings out. */
  check(context: RuleContext): RuleFinding[];
}

/**
 * Runs a rule table over a doctor inventory and returns the stamped,
 * deterministically ordered findings. Throws on duplicate rule ids
 * (a misconfigured table, not a repository problem).
 */
export function runRiskRules(
  input: RiskInput,
  rules: readonly RiskRule[],
): RiskFinding[] {
  const ids = new Set<string>();
  for (const rule of rules) {
    if (ids.has(rule.id)) {
      throw new Error(`duplicate risk rule id: ${rule.id}`);
    }
    ids.add(rule.id);
  }

  const findings: RiskFinding[] = [];
  for (const rule of rules) {
    const matched = input.artifacts.filter((artifact) =>
      matchesApplicability(artifact, rule.appliesTo),
    );
    for (const finding of rule.check({ matched, input })) {
      findings.push({ ...finding, ruleId: rule.id, severity: rule.severity });
    }
  }

  return findings.sort(compareFindings);
}

function matchesApplicability(artifact: RiskArtifact, appliesTo: RiskApplicability): boolean {
  return (
    (!appliesTo.adapters || appliesTo.adapters.includes(artifact.adapter)) &&
    (!appliesTo.kinds || appliesTo.kinds.includes(artifact.kind)) &&
    (!appliesTo.scopes || appliesTo.scopes.includes(artifact.scope))
  );
}

/** Stable order: rule id, then path (path-less findings first), then message. */
function compareFindings(a: RiskFinding, b: RiskFinding): number {
  return (
    compareStrings(a.ruleId, b.ruleId) ||
    compareStrings(a.path ?? "", b.path ?? "") ||
    compareStrings(a.message, b.message)
  );
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

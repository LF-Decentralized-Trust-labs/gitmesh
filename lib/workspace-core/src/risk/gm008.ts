import type { RiskRule } from "./risk.js";

/**
 * GM008 - orphan config: an agent whose configuration sits in the repo but
 * that is unseen in the repository's history (pivot §8.1 item 3).
 * Informational by the pivot's own word: an orphan costs review attention
 * and misleads newcomers about what the team actually uses, but harms
 * nothing at runtime.
 *
 * The engine is pure (no git access), so history is caller-supplied:
 * `RiskInput.historyAdapters` lists the adapters the doctor pipeline found
 * evidence for in repo history, under the caller's documented evidence
 * standard (see the field's docs; the pivot fixes none). The GM004
 * `.gitmesh/lock.json` precedent applies: the rule honors the input the
 * day the pipeline computes it (T1.16/T1.17 lane) and stays silent -
 * `historyAdapters` absent - until then; absence of evidence about
 * history is never treated as evidence of orphanhood.
 *
 * Fires once per adapter that has at least one project- or local-scope
 * artifact in the inventory but is missing from `historyAdapters`.
 * Repo-tier scopes only: user and managed artifacts are machine state, not
 * repository config, and say nothing about what the repo's team uses.
 * `third-party-managers` is exempt - it is not an agent, and ADR-004 says
 * management is never itself a finding.
 */
export const gm008: RiskRule = {
  id: "GM008",
  severity: "info",
  appliesTo: { scopes: ["project", "local"] },
  check: ({ matched, input }) => {
    const history = input.historyAdapters;
    if (history === undefined) {
      return [];
    }
    const present = [...new Set(matched.map((artifact) => artifact.adapter))].sort();
    return present.flatMap((adapter) =>
      adapter === "third-party-managers" || history.includes(adapter)
        ? []
        : [
            {
              adapter,
              message: `Configuration for ${adapter} is present in the repository, but ${adapter} is unseen in its history; if the team has moved on from this agent, retire the orphan config.`,
            },
          ],
    );
  },
};

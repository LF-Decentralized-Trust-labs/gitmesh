import type { RiskRule, RuleFinding } from "./risk.js";

/**
 * GM007 - instruction file exceeds the effective-context threshold (pivot
 * §8.1 item 3). The ETH Zurich ICSE 2026 study the pivot cites (§4.10)
 * measured LLM-generated context files reducing task success 2-3% while
 * raising cost 20%+: context rot is measurable, and an instruction file
 * that outgrows what an agent can attend to is rot by volume. Warning
 * tier: an oversized file degrades results, it does not bypass anything.
 *
 * Applies to the instruction surfaces - `kind: "instructions"` (CLAUDE.md,
 * AGENTS.md, GEMINI.md, copilot-instructions hierarchies) and
 * `kind: "rule"` (`.claude/rules/`, `.cursor/rules/*.mdc`,
 * `.github/instructions/**`, `.clinerules`, …) - in every scope: an
 * oversized user-scope memory file pollutes context the same way a
 * committed one does. Skills, commands and subagent definitions are loaded
 * on demand, not ambiently, and stay out.
 *
 * The threshold is measured in characters of raw file content - the only
 * deterministic unit that needs no tokenizer dependency - and defaults to
 * `GM007_DEFAULT_THRESHOLD` (40 000 chars, roughly 10k tokens at the ~4
 * chars/token rule of thumb). §8.1 says "configurable": the rule is built
 * by `makeGm007(threshold)` so the CLI config that lands with T1.17 can
 * construct the table with a repo-chosen value; the pivot fixes no number,
 * so the default is a maintainer-flagged judgment call.
 */
export const GM007_DEFAULT_THRESHOLD = 40_000;

/** Builds GM007 with a caller-chosen threshold (T1.17 CLI config hook). */
export function makeGm007(threshold: number = GM007_DEFAULT_THRESHOLD): RiskRule {
  return {
    id: "GM007",
    severity: "warning",
    appliesTo: { kinds: ["instructions", "rule"] },
    check: ({ matched }) =>
      matched.flatMap(({ path, content }): RuleFinding[] =>
        content !== undefined && content.length > threshold
          ? [
              {
                path,
                message: `${path} is ${String(content.length)} characters, over the ${String(threshold)}-character effective-context threshold (ICSE 2026 context-rot finding: oversized context measurably hurts agent task success); split it or prune stale content.`,
              },
            ]
          : [],
      ),
  };
}

/** GM007 at the default threshold - the table entry. */
export const gm007 = makeGm007();

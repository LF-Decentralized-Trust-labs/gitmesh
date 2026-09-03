import { GITMESH_MANAGED_CLOSE, GITMESH_MANAGED_OPEN, unfencedLines } from "../normalizer/grammar.js";
import type { RiskRule, RuleFinding } from "./risk.js";

/**
 * GM006 - a generated-looking file hand-edited: managed-marker violation,
 * the pre-lockfile heuristic (pivot §8.1 item 3, ADR-003). A file carrying
 * `<!-- gitmesh:managed -->` markers is generated-looking by definition;
 * once `.gitmesh/lock.json` exists (T5.x), `check` compares managed-region
 * content against recorded hashes, but until then the detectable signal is
 * structural: a marker pair a hand edit broke. Every violation means the
 * ownership boundary ADR-003 rests on can no longer be drawn - `apply`
 * could not tell managed content from human content in this file.
 *
 * Violations, in the order encountered:
 * - an opening marker inside an already-open region (regions never nest);
 * - a closing marker with no open region;
 * - a damaged marker: a full-line HTML comment naming `gitmesh:managed`
 *   that matches neither the exact open nor close grammar (a deleted
 *   `-->`, text appended after it, a marker split across lines);
 * - an open region never closed before end of file.
 *
 * Marker and fence grammar are imported from the normalizer's shared
 * grammar module (one ADR-003 contract, no private copy): full-line
 * comments only, attributes allowed on the opener.
 * Fenced code blocks are skipped under the same fence rules, so a
 * marker shown in a fenced example - docs about gitmesh itself - never
 * counts; an inline-code mention never matches because the line does not
 * begin with `<!--`. Applies to every inventoried artifact with content,
 * any adapter and scope: only files that actually carry marker-shaped
 * lines can fire, and markers are the same contract everywhere. Findings
 * carry no adapter, so a file inventoried by several adapters (a root
 * AGENTS.md) reports once. Warning tier: the marker violation is heuristic
 * evidence of a hand edit, and the remediation - restore the pair - is
 * recoverable from git (ADR-003).
 */
export const gm006: RiskRule = {
  id: "GM006",
  severity: "warning",
  appliesTo: {},
  check: ({ matched }) =>
    matched.flatMap(({ path, content }) => (content === undefined ? [] : violations(path, content))),
};

function violations(path: string, content: string): RuleFinding[] {
  const out: RuleFinding[] = [];
  let openLine: number | undefined;
  for (const { n, trimmed } of unfencedLines(content)) {
    if (GITMESH_MANAGED_OPEN.test(trimmed)) {
      if (openLine === undefined) {
        openLine = n;
      } else {
        out.push({
          path,
          message: `Managed marker on line ${n} of ${path} opens inside the region opened on line ${openLine}; managed regions cannot nest - remove one of the two openers.`,
        });
      }
      continue;
    }
    if (GITMESH_MANAGED_CLOSE.test(trimmed)) {
      if (openLine === undefined) {
        out.push({
          path,
          message: `Closing marker <!-- /gitmesh:managed --> on line ${n} of ${path} matches no open region; restore the opening marker or delete the stray line.`,
        });
      } else {
        openLine = undefined;
      }
      continue;
    }
    if (trimmed.startsWith("<!--") && trimmed.includes("gitmesh:managed")) {
      out.push({
        path,
        message: `Damaged gitmesh:managed marker on line ${n} of ${path}; restore the exact single-line <!-- gitmesh:managed --> and <!-- /gitmesh:managed --> pair.`,
      });
    }
  }
  if (openLine !== undefined) {
    out.push({
      path,
      message: `Managed region opened on line ${openLine} of ${path} is never closed; restore the <!-- /gitmesh:managed --> line so managed content can be told apart from hand edits.`,
    });
  }
  return out;
}

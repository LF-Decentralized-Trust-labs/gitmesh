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
 * Marker grammar mirrors the §10.4 normalizer: full-line comments only
 * (leading/trailing whitespace ignored), attributes allowed on the opener.
 * Fenced code blocks are skipped under the normalizer's fence rules, so a
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

/** The §10.4 marker grammar, on trimmed lines. */
const OPEN_RE = /^<!--\s*gitmesh:managed\b[^>]*-->$/;
const CLOSE_RE = /^<!--\s*\/gitmesh:managed\s*-->$/;

/** The §10.4 fence-open grammar (normalize.ts): marker run + info string. */
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*[^`]*$/;

function violations(path: string, content: string): RuleFinding[] {
  const out: RuleFinding[] = [];
  const lines = content.split("\n");
  let openLine: number | undefined;
  let fenceClose: RegExp | undefined;
  lines.forEach((raw, index) => {
    const n = index + 1;
    const line = raw.replace(/\r$/, "");
    if (fenceClose) {
      if (fenceClose.test(line)) {
        fenceClose = undefined;
      }
      return;
    }
    const trimmed = line.trim();
    if (OPEN_RE.test(trimmed)) {
      if (openLine === undefined) {
        openLine = n;
      } else {
        out.push({
          path,
          message: `Managed marker on line ${n} of ${path} opens inside the region opened on line ${openLine}; managed regions cannot nest - remove one of the two openers.`,
        });
      }
      return;
    }
    if (CLOSE_RE.test(trimmed)) {
      if (openLine === undefined) {
        out.push({
          path,
          message: `Closing marker <!-- /gitmesh:managed --> on line ${n} of ${path} matches no open region; restore the opening marker or delete the stray line.`,
        });
      } else {
        openLine = undefined;
      }
      return;
    }
    if (trimmed.startsWith("<!--") && trimmed.includes("gitmesh:managed")) {
      out.push({
        path,
        message: `Damaged gitmesh:managed marker on line ${n} of ${path}; restore the exact single-line <!-- gitmesh:managed --> and <!-- /gitmesh:managed --> pair.`,
      });
      return;
    }
    const fence = FENCE_OPEN_RE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      fenceClose = new RegExp(`^ {0,3}[${marker[0]}]{${marker.length},}[ \\t]*$`);
    }
  });
  if (openLine !== undefined) {
    out.push({
      path,
      message: `Managed region opened on line ${openLine} of ${path} is never closed; restore the <!-- /gitmesh:managed --> line so managed content can be told apart from hand edits.`,
    });
  }
  return out;
}

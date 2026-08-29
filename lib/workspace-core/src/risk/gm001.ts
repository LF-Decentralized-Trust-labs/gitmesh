import type { RiskRule } from "./risk.js";

/**
 * GM001 - plaintext secret or token in an MCP config, agent settings, hooks
 * or config file (pivot §8.1 item 3). Regex over known token shapes plus an
 * entropy gate on secret-named keys; findings name the file, line and key,
 * never the value (hard rule 5).
 *
 * The scanner is format-agnostic: it reads lines, not JSON/TOML/YAML trees,
 * so the same code covers `.mcp.json`, `.codex/config.toml`,
 * `opencode.jsonc` and `.gemini/settings.json` without a parser and cannot
 * throw on malformed input. Cost: unquoted YAML values reach only the
 * token-shape patterns (the entropy gate needs a quoted `key: "value"`).
 *
 * Third-party-manager files (`.ruler/mcp.json`, `.rulesync/mcp.jsonc`) are
 * scanned too: ADR-004 protects the manager's territory from GitMesh writes
 * and never flags management itself, but a committed token is a property
 * of the file, not of who generated it.
 */
export const gm001: RiskRule = {
  id: "GM001",
  severity: "error",
  appliesTo: { kinds: ["mcp-config", "settings", "config", "hooks"] },
  check: ({ matched }) =>
    matched.flatMap(({ path, content }) =>
      content === undefined
        ? []
        : scanForSecrets(content).map(({ line, key, reason }) => ({
            path,
            message: `Plaintext ${reason} ${
              key === undefined ? `on line ${line}` : `in "${key}" (line ${line})`
            }; move it out of the file and reference it from the environment.`,
          })),
    ),
};

/** One plaintext secret located in a file; carries no part of the value. */
export interface SecretHit {
  line: number;
  key?: string;
  reason: string;
}

/**
 * Vendor-documented token shapes. Each is bounded and linear (no nested
 * quantifiers) so scanning any input stays cheap and total.
 */
const TOKEN_PATTERNS: readonly (readonly [reason: string, re: RegExp])[] = [
  ["private key", /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g],
  ["GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}\b/g],
  ["OpenAI/Anthropic-style key", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["Stripe key", /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ["AWS access key id", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/g],
  ["Hugging Face token", /\bhf_[A-Za-z0-9]{30,}\b/g],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g],
  ["credential in URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"']+:[^\s/@"']{4,}@/gi],
];

/**
 * `key: "value"` / `key = "value"` pairs: JSON/JSONC quoted keys, TOML and
 * env-style bare keys, inline TOML tables; double- or single-quoted values.
 */
const PAIR_RE =
  /(?:"((?:[^"\\]|\\.)*)"|'([^'\\]*)'|([A-Za-z_][\w.-]*))\s*[:=]\s*(?:"((?:[^"\\]|\\.)*)"|'([^'\\]*)')/g;

/** Key names that carry credentials. Bare `auth` is out: it matches `author`. */
const KEY_RE = /token|secret|passw(?:or)?d|api[_-]?key|credential|private[_-]?key|authorization|bearer/i;

/** Values that reference a secret rather than contain one, or are stand-ins. */
const PLACEHOLDER_RE =
  /^(?:\$|%|\{\{|<|op:\/\/|env:|\/|\.\/|~|https?:\/\/|changeme|change-me|your[-_]|placeholder|example|dummy|xxx|\*{3}|\.\.\.)/i;

/** Shannon entropy of `value` in bits per character. */
export function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * A credential-shaped value: long enough, token alphabet only, mixes digits
 * and letters (paths and words do not), and ≥ 3.5 bits/char - between the
 * usual hex (3.0) and base64 (4.5) thresholds.
 */
function looksRandom(value: string): boolean {
  return (
    value.length >= 16 &&
    /^[A-Za-z0-9_\-+/=.]+$/.test(value) &&
    /\d/.test(value) &&
    /[A-Za-z]/.test(value) &&
    shannonEntropy(value) >= 3.5
  );
}

/**
 * Scans `content` line by line. Token shapes are matched anywhere on the
 * line (so key-less `args` entries count) and attributed to the enclosing
 * `key: "value"` pair when there is one; remaining pairs with a secret-named
 * key and a random-looking, non-placeholder value are reported as
 * high-entropy. One hit per line and key; the first reason wins.
 */
export function scanForSecrets(content: string): SecretHit[] {
  const hits: SecretHit[] = [];
  content.split("\n").forEach((raw, index) => {
    const line = raw.replace(/\r$/, "");
    const pairs = [...line.matchAll(PAIR_RE)].map((m) => ({
      key: m[1] ?? m[2] ?? m[3] ?? "",
      value: m[4] ?? m[5] ?? "",
      start: m.index,
      end: m.index + m[0].length,
    }));
    const seen = new Set<string | undefined>();
    const add = (key: string | undefined, reason: string): void => {
      if (!seen.has(key)) {
        seen.add(key);
        hits.push(key === undefined ? { line: index + 1, reason } : { line: index + 1, key, reason });
      }
    };
    for (const [reason, re] of TOKEN_PATTERNS) {
      for (const m of line.matchAll(re)) {
        add(pairs.find((p) => p.start <= m.index && m.index < p.end)?.key, reason);
      }
    }
    for (const { key, value } of pairs) {
      if (KEY_RE.test(key) && !PLACEHOLDER_RE.test(value) && looksRandom(value)) {
        add(key, "high-entropy value");
      }
    }
  });
  return hits;
}

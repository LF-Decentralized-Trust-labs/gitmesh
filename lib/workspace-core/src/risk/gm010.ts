import type { RiskArtifact, RiskRule } from "./risk.js";

/**
 * GM010 - CLAUDE.md without an AGENTS.md bridge (pivot §8.1 item 3, §4.2).
 * AGENTS.md is the cross-tool default. Claude Code reads it since v2.1.277
 * (2026-09-18, closing anthropics/claude-code#6235), but only in a project
 * with no CLAUDE.md: when both exist it reads CLAUDE.md alone. So the gap
 * is a CLAUDE.md that does not reach AGENTS.md, and the fix that works on
 * every Claude Code version - an `@AGENTS.md` import line inside CLAUDE.md,
 * or a symlink - is exactly the shim the claude-code emitter later compiles
 * (§8.2, T4.2). Warning tier: a missing bridge splits the instruction
 * source, it endangers nothing.
 *
 * Root-level files only (`path` exactly `CLAUDE.md` / `AGENTS.md`, project
 * scope): the bridge pattern is about the repo's shared instruction
 * source; nested pairs are per-directory context and their divergence is
 * the drift differ's lane (§10.4). Two firing shapes, one finding each:
 * - CLAUDE.md present, no root AGENTS.md: every AGENTS.md-reading agent
 *   misses the instructions;
 * - both present but CLAUDE.md neither contains an `@AGENTS.md` /
 *   `@./AGENTS.md` import token nor is either file a symlink to the other:
 *   two sources that will drift, and Claude reads only one of them.
 * AGENTS.md with no root CLAUDE.md is silent: current Claude Code reads it
 * natively (maintainer decision on #484, pivot §7 "state the Claude Code
 * AGENTS.md status factually", §17.4).
 *
 * Several adapters inventory the same root file, and different entries may
 * carry different evidence (one resolves a symlink to content, another
 * stamps `symlinkTarget`), so every entry per path is consulted - the
 * verdict is inventory-order independent, as the engine contract demands.
 * The import scan is a lenient line-token match (a shim shown inside a
 * fenced example would count as a bridge): erring silent on an ambiguous
 * bridge beats nagging a repo that already joined the two files. A
 * CLAUDE.md with no readable content in any entry is treated as bridged
 * for the same reason (fires only on explicit evidence, the GM009
 * precedent). GEMINI.md gets the same shim from the T4.6 emitter, but §8.1
 * scopes this finding to the CLAUDE.md↔AGENTS.md pair and the rule follows
 * it.
 */
export const gm010: RiskRule = {
  id: "GM010",
  severity: "warning",
  appliesTo: { kinds: ["instructions"], scopes: ["project"] },
  check: ({ matched }) => {
    const claudes = matched.filter((artifact) => artifact.path === "CLAUDE.md" && artifact.broken !== true);
    const agents = matched.filter((artifact) => artifact.path === "AGENTS.md" && artifact.broken !== true);
    if (claudes.length > 0 && agents.length === 0) {
      return [
        {
          path: "CLAUDE.md",
          message:
            'CLAUDE.md is present but there is no AGENTS.md for the other agents to read; move the shared instructions to AGENTS.md and keep CLAUDE.md as an "@AGENTS.md" shim.',
        },
      ];
    }
    if (claudes.length > 0 && agents.length > 0 && !bridged(claudes, agents)) {
      return [
        {
          path: "CLAUDE.md",
          message:
            'CLAUDE.md does not bridge to AGENTS.md; add an "@AGENTS.md" import line to CLAUDE.md (or symlink one file to the other) so both stay one instruction source.',
        },
      ];
    }
    return [];
  },
};

/** An `@AGENTS.md` / `@./AGENTS.md` import token on its own or in a line. */
const IMPORT_RE = /(^|\s)@(\.\/)?AGENTS\.md(\s|$)/m;

/**
 * True when `content` carries the `@AGENTS.md` bridge token - the same
 * lenient match this rule accepts as a bridge, exported so the doctor's
 * drift input applies one definition of "bridged": a CLAUDE.md that is the
 * `@AGENTS.md` shim is a pointer to AGENTS.md, not an independent copy to
 * diff.
 */
export function importsAgentsMd(content: string): boolean {
  return IMPORT_RE.test(content);
}

function bridged(claudes: readonly RiskArtifact[], agents: readonly RiskArtifact[]): boolean {
  const contents = claudes.flatMap((artifact) => (artifact.content === undefined ? [] : [artifact.content]));
  return (
    claudes.some((artifact) => symlinksTo(artifact, "AGENTS.md")) ||
    agents.some((artifact) => symlinksTo(artifact, "CLAUDE.md")) ||
    contents.length === 0 ||
    contents.some((content) => IMPORT_RE.test(content))
  );
}

function symlinksTo(artifact: RiskArtifact, target: string): boolean {
  return artifact.symlinkTarget?.replace(/^\.\//, "") === target;
}

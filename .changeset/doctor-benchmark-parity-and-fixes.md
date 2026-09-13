---
"@gitmesh/workspace-core": minor
"gitmesh-agents": patch
"gitmesh-cli": patch
---

Benchmark-parity checklist plus two doctor fixes from a functional review pass (pivot §12 T1.19).

`docs/comparisons.md` now enumerates every check published by Claude Code's `/doctor` checkup (the `/checkup` alias never was a rename), cc-health-check (20 checks), agents-lint (56 rules + 2 dynamic families) and AgentLint (51 core + 7 extended checks today - the circulating "33" is stale), and maps each one to a GM rule, an inventory item, the drift differ, or a documented out-of-scope with the tool that owns it. The page also names where gitmesh doctor honestly falls short today. Sources checked 2026-09-13.

Doctor fixes found while building the checklist: the drift differ no longer charges a divergent pair for a CLAUDE.md that carries the `@AGENTS.md` import token - the exact shim GM010 recommends is a pointer to AGENTS.md, not an independent copy, so adopting doctor's own remediation no longer costs score (workspace-core exports `importsAgentsMd` so GM010 and the drift input share one definition of "bridged"); and GM011 no longer judges references in nested artifacts (a vendored repo's or monorepo subtree's CLAUDE.md resolves imports against its own directory, which the inventory does not cover, so "absent from the inventory" proved nothing and produced false dangling-reference findings).

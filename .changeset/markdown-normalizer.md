---
"@gitmesh/workspace-core": minor
---

Add the instruction markdown normalizer + block hasher (pivot §10.4, T1.8): `normalizeInstructionMarkdown` parses instruction markdown into normalized blocks (headings, paragraphs, fences, lists), strips adapter wrapper/marker comments while flagging blocks inside gitmesh managed regions (ADR-003), normalizes whitespace so formatting dialects hash identically, and computes deterministic SHA-256 hashes per block and per document. Cursor `.mdc` frontmatter (`description`, `globs`, `alwaysApply`) and Copilot `applyTo` frontmatter map onto one `InstructionScope` with unified scope globs, excluded from content hashes so the same rule body scoped in different dialects compares equal. `resolveLogicalPath`/`isSameLogicalDocument` resolve symlinked instruction files (e.g. `CLAUDE.md → AGENTS.md`) to a single logical document so the T1.9 differ can report them as zero drift.

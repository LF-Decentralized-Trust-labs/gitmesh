---
"@gitmesh/workspace-core": minor
---

Add the cross-tool instruction drift differ (pivot §10.4, T1.9): `computeDriftReport` takes detected instruction files, collapses paths resolving to the same logical document (symlink topology, e.g. `CLAUDE.md → AGENTS.md`) into one zero-drift document reported as a healthy `symlinkGroups` pattern, and computes per-pair block set diffs (multiset semantics) plus sequence diffs (`reordered` via longest common subsequence) over T1.8 normalized block hashes. `divergentBlocks` aggregates the "present in A, missing in B/C" view across all documents with sorted provenance. Pure data-in/data-out with deterministic ordering throughout; ships a seeded 3-way-drift fixture (with a real committed symlink) whose report is asserted byte-for-byte against `three-way-expected.json`.

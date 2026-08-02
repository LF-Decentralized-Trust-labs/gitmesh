---
"@gitmesh/workspace-adapters": patch
---

Extract the filesystem plumbing duplicated between the claude-code and codex detectors into a shared internal module (`src/detect-fs.ts`) and their duplicated test wiring into a test-only harness (`src/detect-test-utils.ts`), ahead of the T1.3+ detectors. Internal refactor: no output, fixture, or public API changes.

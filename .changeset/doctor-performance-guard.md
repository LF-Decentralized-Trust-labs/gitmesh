---
"gitmesh-agents": patch
---

Guard `gitmesh doctor` performance (pivot §12 E1, T1.18). A dedicated CI step (`pnpm test:perf`) generates a deterministic 5,000-file repository into a temp directory - 500 modules, nested `AGENTS.md` files, stray `.mdc` files the cursor detector content-reads, a divergent root `AGENTS.md`/`CLAUDE.md` pair, and a `node_modules` decoy that must stay out of the inventory - and asserts a full doctor run (detectors, drift, rules, render) finishes in under 2 seconds, taking the best of three timed runs after one untimed warm-up. Sanity assertions pin the scan to the fixture so the guard cannot pass against an empty or mis-rooted walk. The suite is gated behind `GITMESH_DOCTOR_PERF=1` and skips in the regular parallel test run, where wall-clock timing would measure worker contention instead of doctor.

---
"gitmesh-cli": patch
---

Hold every `gitmesh-cli` release to ADR-006, no telemetry (pivot §12 T2.3). The clean-install smoke test, which CI runs on every pull request and the release workflow runs before every publish, now runs the packed CLI under a network spy (`scripts/network-spy.mjs`) that ends the process on the first network connection, listening socket, UDP traffic, DNS query, subprocess or worker thread: every top-level command `gitmesh --help` lists, bare and with `--help`, plus each `doctor` output mode. It also fails when `gitmesh-cli` or any of its dependencies has an install script. No runtime change.

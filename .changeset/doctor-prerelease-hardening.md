---
"@gitmesh/workspace-core": patch
"gitmesh-cli": patch
---

Pre-release hardening for `gitmesh doctor`. Hard rule 5: GM011 now quotes a permission entry only when nothing in it may be a credential (a GM001 hit, a credential-named word, a `user:password` argument or a random-looking word) and shows `Tool(…)` otherwise, and drift blocks collapse whole private-key blocks and mask values behind a credential name (`password: …`, `Authorization: Bearer …`, `-u user:…`) in every output mode, through the new `mayHoldSecret` and `redactSecrets` helpers next to `scanForSecrets`. The GM003 Codex message no longer suggests `approval_policy = "untrusted"`, which Codex retired in August 2026 and now refuses to load. The npm README describes the working `doctor` command.

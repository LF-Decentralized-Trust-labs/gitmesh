---
"gitmesh-cli": patch
---

`gitmesh doctor` no longer reads the machine without `--user` (#493). The org-managed Claude settings probe, Codex's `requirements.toml` probe and `CODEX_HOME` hint, and the Antigravity CLI settings probe now run only with `--user`, like the user-scope files, so the same commit reports the same on a laptop and in CI. GM002 now counts an agent as present only through its project- or local-scope artifacts: a user-scope file or an org-managed probe no longer makes a repository with no config for that agent fail the default `--fail-on warning` run.

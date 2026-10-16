# Architecture Decision Records

Decisions that bind pivot-era work (the Agent Workspace Compiler,
`doc/pivot/pivot.md`). One decision per file, numbered in merge order, never
renumbered. A superseded ADR keeps its file with status `Superseded by
ADR-NNN`.

| ADR | Title | Status |
|---|---|---|
| [ADR-001](ADR-001-canonical-source.md) | Canonical source is AGENTS.md plus `.gitmesh/workspace.yaml` | Accepted |
| [ADR-002](ADR-002-no-server.md) | No server, no database, no network in the default path | Accepted |
| [ADR-003](ADR-003-managed-marker-merge.md) | Managed-marker merge semantics | Accepted |
| [ADR-004](ADR-004-coexistence.md) | Coexistence with third-party config managers | Accepted |
| [ADR-005](ADR-005-npm-package-naming.md) | npm package is `gitmesh-cli`, binary is `gitmesh` | Accepted |
| [ADR-006](ADR-006-no-telemetry.md) | No telemetry, opt-in included; adoption measured from public signals | Accepted |

Format: Status / Date / Context / Decision / Consequences. Cite
`doc/pivot/pivot.md` section numbers so a decision's evidence can be audited.

Numbering note: `pivot.md` T2.3 refers to the no-telemetry decision as
"ADR-005"; that number was consumed here by npm naming (merge order wins), so
the no-telemetry decision landed as **ADR-006**.

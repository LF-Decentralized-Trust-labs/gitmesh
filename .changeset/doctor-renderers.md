---
"@gitmesh/workspace-core": minor
---

Add the `gitmesh doctor` report renderers (pivot §8.1 item 4, T1.16): a `DoctorReport` model (inventory with adapter provenance and manager labels, the T1.9 drift report, the T1.10 findings) rendered three ways - `renderDoctorTty` (inventory grouped by adapter, drift per document pair, findings grouped by severity, opt-in ANSI colors, 0–100 score), `renderDoctorJson` (versioned `schemaVersion: 1` schema, projected field by field so artifact content can never leak) and `renderDoctorMarkdown` (PR-comment layout with a collapsed inventory). The score starts at 100 and costs 20 per error, 5 per warning and 5 per divergent instruction pair; informational findings are free. Pure data → string with deterministic ordering; ships one file snapshot per mode plus a redaction guarantee across all three.

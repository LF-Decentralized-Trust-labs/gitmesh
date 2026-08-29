---
"@gitmesh/workspace-core": minor
---

Add the table-driven risk-rule engine (pivot §8.1, T1.10): a `RiskRule` interface (versioned ESLint-style `id`, fixed `severity`, declarative `appliesTo` filter over adapter/kind/scope, pure `check` → findings) and `runRiskRules`, which filters the doctor inventory per rule, invokes `check` with the matched subset plus the full input (so absence rules like GM002/GM010 can fire), and stamps the rule's id and severity onto every finding. Findings carry message and provenance only (no raw artifact content); rule messages must still redact any secret values. Deterministic ordering (rule id, path, message) independent of table order. The `riskRules` table ships empty; GM001–GM011 land with T1.11–T1.15.

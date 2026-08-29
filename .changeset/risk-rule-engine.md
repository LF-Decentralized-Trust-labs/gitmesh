---
"@gitmesh/workspace-core": minor
---

Add the table-driven risk-rule engine (pivot §8.1, T1.10): a `RiskRule` interface (versioned ESLint-style `id`, fixed `severity`, declarative `appliesTo` filter over adapter/kind/scope, pure `check` → findings) and `runRiskRules`, which filters the doctor inventory per rule, invokes `check` with the matched subset plus the full input (so absence rules like GM002/GM010 can fire), and stamps the rule's id and severity onto every finding. The engine copies only message, path and adapter out of each finding (raw artifact content can never leak through); rule messages must still redact any secret values. Identical findings collapse to one (the same file inventoried by several adapters), and ordering (rule id, path, adapter, message) is deterministic and independent of table and inventory order. The `riskRules` table ships empty; GM001–GM011 land with T1.11–T1.15.

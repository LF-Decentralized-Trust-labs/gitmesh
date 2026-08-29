import { gm001 } from "./gm001.js";
import { gm002 } from "./gm002.js";
import type { RiskRule } from "./risk.js";

/**
 * The GM rule table, in id order. T1.12–T1.15 land GM003–GM011 here; each
 * rule ships with triggering and non-triggering fixtures under
 * `fixtures/risk/`.
 */
export const riskRules: readonly RiskRule[] = [gm001, gm002];

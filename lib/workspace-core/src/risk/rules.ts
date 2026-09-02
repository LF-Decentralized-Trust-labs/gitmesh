import { gm001 } from "./gm001.js";
import { gm002 } from "./gm002.js";
import { gm003 } from "./gm003.js";
import { gm004 } from "./gm004.js";
import { gm005 } from "./gm005.js";
import { gm006 } from "./gm006.js";
import type { RiskRule } from "./risk.js";

/**
 * The GM rule table, in id order. T1.14–T1.15 land GM007–GM011 here; each
 * rule ships with triggering and non-triggering fixtures under
 * `fixtures/risk/`.
 */
export const riskRules: readonly RiskRule[] = [gm001, gm002, gm003, gm004, gm005, gm006];

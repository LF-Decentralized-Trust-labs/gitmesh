import { gm001 } from "./gm001.js";
import { gm002 } from "./gm002.js";
import { gm003 } from "./gm003.js";
import { gm004 } from "./gm004.js";
import { gm005 } from "./gm005.js";
import { gm006 } from "./gm006.js";
import { gm007 } from "./gm007.js";
import { gm008 } from "./gm008.js";
import { gm009 } from "./gm009.js";
import { gm010 } from "./gm010.js";
import { gm011 } from "./gm011.js";
import type { RiskRule } from "./risk.js";

/**
 * The GM rule table, in id order - all eleven §8.1 item 3 ids
 * (T1.11–T1.15). GM011's cross-tool generalization beyond claude-code
 * waits on verified reference syntaxes (see gm011.ts). Each rule ships
 * with triggering and non-triggering fixtures under `fixtures/risk/`;
 * per-rule docs metadata (the SEO surface) lands with T2.1.
 */
export const riskRules: readonly RiskRule[] = [
  gm001,
  gm002,
  gm003,
  gm004,
  gm005,
  gm006,
  gm007,
  gm008,
  gm009,
  gm010,
  gm011,
];

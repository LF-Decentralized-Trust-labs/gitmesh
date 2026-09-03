export { workspaceIRSchema, type WorkspaceIR } from "./workspace-ir.js";
export { parseJsonc } from "./jsonc.js";
export {
  normalizeInstructionMarkdown,
  sha256Hex,
  hashBlock,
  hashDocument,
  parseScopeFrontmatter,
  resolveLogicalPath,
  isSameLogicalDocument,
  type BlockKind,
  type NormalizedBlock,
  type NormalizedDocument,
  type InstructionScope,
  type FrontmatterSplit,
} from "./normalizer/index.js";
export {
  computeDriftReport,
  type DriftDocumentInput,
  type DriftDocument,
  type DriftBlockRef,
  type PairDrift,
  type BlockPresence,
  type DriftReport,
} from "./drift/index.js";
export {
  runRiskRules,
  riskRules,
  GM007_DEFAULT_THRESHOLD,
  makeGm007,
  type RiskSeverity,
  type RiskArtifactScope,
  type RiskArtifact,
  type RiskInput,
  type RiskApplicability,
  type RuleFinding,
  type RiskFinding,
  type RuleContext,
  type RiskRule,
} from "./risk/index.js";

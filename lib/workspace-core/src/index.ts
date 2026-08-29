export { workspaceIRSchema, type WorkspaceIR } from "./workspace-ir.js";
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
export * from "./risk/index.js";

export {
  normalizeInstructionMarkdown,
  sha256Hex,
  hashBlock,
  hashDocument,
  type BlockKind,
  type NormalizedBlock,
  type NormalizedDocument,
} from "./normalize.js";
export {
  parseScopeFrontmatter,
  type InstructionScope,
  type FrontmatterSplit,
} from "./frontmatter.js";
export { resolveLogicalPath, isSameLogicalDocument } from "./symlink.js";

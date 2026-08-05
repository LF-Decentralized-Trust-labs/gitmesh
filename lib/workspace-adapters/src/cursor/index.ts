import type { AgentAdapter } from "../types.js";
import { detect } from "./detect.js";

export {
  detect,
  extractFrontmatter,
  parseMdcFrontmatter,
  type CursorArtifact,
  type CursorArtifactKind,
  type MdcFrontmatter,
} from "./detect.js";

function notImplemented(method: string, plannedTask: string): never {
  throw new Error(
    `cursor adapter: ${method}() is not implemented yet - it lands with pivot task ${plannedTask}`,
  );
}

/**
 * The `cursor` adapter. Only `detect()` is implemented (T1.3); the
 * remaining contract methods land with their own epics and fail loudly until
 * then rather than pretending to be no-ops.
 */
export const cursorAdapter: AgentAdapter = {
  name: "cursor",
  version: "0.1.0",
  detect,
  importArtifacts: () => notImplemented("importArtifacts", "T3.5"),
  capabilities: () => notImplemented("capabilities", "T7.2"),
  plan: () => notImplemented("plan", "T5.1"),
  emit: () => notImplemented("emit", "T4.4"),
  fixtures: [
    { name: "full-surface" },
    { name: "legacy-cursorrules" },
    { name: "mdc-frontmatter" },
    { name: "no-artifacts" },
  ],
};

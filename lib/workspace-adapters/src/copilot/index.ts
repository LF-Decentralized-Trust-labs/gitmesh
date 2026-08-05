import type { AgentAdapter } from "../types.js";
import { detect } from "./detect.js";

export {
  detect,
  extractFrontmatter,
  parseCopilotFrontmatter,
  type CopilotArtifact,
  type CopilotArtifactKind,
  type CopilotFrontmatter,
} from "./detect.js";

function notImplemented(method: string, plannedTask: string): never {
  throw new Error(
    `copilot adapter: ${method}() is not implemented yet - it lands with pivot task ${plannedTask}`,
  );
}

/**
 * The `copilot` adapter. Only `detect()` is implemented (T1.4); the
 * remaining contract methods land with their own epics and fail loudly until
 * then rather than pretending to be no-ops.
 */
export const copilotAdapter: AgentAdapter = {
  name: "copilot",
  version: "0.1.0",
  detect,
  importArtifacts: () => notImplemented("importArtifacts", "T3.6"),
  capabilities: () => notImplemented("capabilities", "T7.2"),
  plan: () => notImplemented("plan", "T5.1"),
  emit: () => notImplemented("emit", "T4.5"),
  fixtures: [
    { name: "full-surface" },
    { name: "instructions-frontmatter" },
    { name: "no-artifacts" },
  ],
};

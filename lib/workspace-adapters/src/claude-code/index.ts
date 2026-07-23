import type { AgentAdapter } from "../types.js";
import { detect } from "./detect.js";

export {
  defaultManagedSettingsPaths,
  detect,
  type ClaudeCodeArtifact,
  type ClaudeCodeArtifactKind,
} from "./detect.js";

function notImplemented(method: string, plannedTask: string): never {
  throw new Error(
    `claude-code adapter: ${method}() is not implemented yet — it lands with pivot task ${plannedTask}`,
  );
}

/**
 * The `claude-code` adapter. Only `detect()` is implemented (T1.1); the
 * remaining contract methods land with their own epics and fail loudly until
 * then rather than pretending to be no-ops.
 */
export const claudeCodeAdapter: AgentAdapter = {
  name: "claude-code",
  version: "0.1.0",
  detect,
  importArtifacts: () => notImplemented("importArtifacts", "T3.3"),
  capabilities: () => notImplemented("capabilities", "T7.2"),
  plan: () => notImplemented("plan", "T5.1"),
  emit: () => notImplemented("emit", "T4.2"),
  fixtures: [
    { name: "full-surface" },
    { name: "no-artifacts" },
    { name: "scoped-and-managed" },
    { name: "user-scope-not-requested" },
  ],
};

import type { AgentAdapter } from "../types.js";
import { detect } from "./detect.js";

export {
  defaultRequirementsTomlPaths,
  detect,
  type CodexArtifact,
  type CodexArtifactKind,
} from "./detect.js";

function notImplemented(method: string, plannedTask: string): never {
  throw new Error(
    `codex adapter: ${method}() is not implemented yet — it lands with pivot task ${plannedTask}`,
  );
}

/** The `codex` adapter. Only `detect()` is implemented (T1.2). */
export const codexAdapter: AgentAdapter = {
  name: "codex",
  version: "0.1.0",
  detect,
  importArtifacts: () => notImplemented("importArtifacts", "T3.4"),
  capabilities: () => notImplemented("capabilities", "T7.2"),
  plan: () => notImplemented("plan", "T5.1"),
  emit: () => notImplemented("emit", "T4.3"),
  fixtures: [
    { name: "codex-home-hint" },
    { name: "full-surface" },
    { name: "no-artifacts" },
    { name: "user-and-managed" },
  ],
};

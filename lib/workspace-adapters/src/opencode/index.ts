import type { AgentAdapter } from "../types.js";
import { detect } from "./detect.js";

export { detect, type OpenCodeArtifact, type OpenCodeArtifactKind } from "./detect.js";

function notImplemented(method: string, plannedTask: string): never {
  throw new Error(
    `opencode adapter: ${method}() is not implemented yet - it lands with pivot task ${plannedTask}`,
  );
}

/** The `opencode` adapter. Only `detect()` is implemented (T1.6). */
export const openCodeAdapter: AgentAdapter = {
  name: "opencode",
  version: "0.1.0",
  detect,
  importArtifacts: () => notImplemented("importArtifacts", "T3.8"),
  capabilities: () => notImplemented("capabilities", "T7.6"),
  plan: () => notImplemented("plan", "T5.1"),
  emit: () => notImplemented("emit", "T4.7"),
  fixtures: [
    { name: "full-surface" },
    { name: "no-artifacts" },
    { name: "plural-dirs" },
  ],
};

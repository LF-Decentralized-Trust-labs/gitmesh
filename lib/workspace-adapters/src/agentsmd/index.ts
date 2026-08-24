import type { AgentAdapter } from "../types.js";
import { detect } from "./detect.js";

export { detect, type AgentsMdArtifact, type AgentsMdArtifactKind } from "./detect.js";

function notImplemented(method: string, plannedTask: string): never {
  throw new Error(
    `agentsmd adapter: ${method}() is not implemented yet - it lands with pivot task ${plannedTask}`,
  );
}

/** The `agentsmd` adapter. Only `detect()` is implemented (T1.6). */
export const agentsMdAdapter: AgentAdapter = {
  name: "agentsmd",
  version: "0.1.0",
  detect,
  importArtifacts: () => notImplemented("importArtifacts", "T3.9"),
  capabilities: () => notImplemented("capabilities", "T7.2"),
  plan: () => notImplemented("plan", "T5.1"),
  emit: () => notImplemented("emit", "T4.1"),
  fixtures: [{ name: "full-surface" }, { name: "no-artifacts" }, { name: "root-only" }],
};

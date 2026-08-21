import type { AgentAdapter } from "../types.js";
import { detect } from "./detect.js";

export {
  defaultAntigravitySettingsPaths,
  detect,
  type AntigravityArtifact,
  type AntigravityArtifactKind,
} from "./detect.js";

function notImplemented(method: string, plannedTask: string): never {
  throw new Error(
    `antigravity adapter: ${method}() is not implemented yet - it lands with pivot task ${plannedTask}`,
  );
}

/** The `antigravity` adapter. Only `detect()` is implemented (T1.5). */
export const antigravityAdapter: AgentAdapter = {
  name: "antigravity",
  version: "0.1.0",
  detect,
  importArtifacts: () => notImplemented("importArtifacts", "T3.7"),
  capabilities: () => notImplemented("capabilities", "T7.8"),
  plan: () => notImplemented("plan", "T5.1"),
  emit: () => notImplemented("emit", "T4.6"),
  fixtures: [
    { name: "full-surface" },
    { name: "managed-probe" },
    { name: "no-artifacts" },
    { name: "plugin-bundles" },
  ],
};

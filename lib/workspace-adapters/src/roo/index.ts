import type { AgentAdapter } from "../types.js";
import { detect } from "./detect.js";

export { detect, type RooArtifact, type RooArtifactKind } from "./detect.js";

function notImplemented(method: string): never {
  throw new Error(
    `roo adapter: ${method}() is not implemented yet - it lands with a post-launch pivot task`,
  );
}

/** The `roo` adapter. Only `detect()` is implemented (T1.6). */
export const rooAdapter: AgentAdapter = {
  name: "roo",
  version: "0.1.0",
  detect,
  importArtifacts: () => notImplemented("importArtifacts"),
  capabilities: () => notImplemented("capabilities"),
  plan: () => notImplemented("plan"),
  emit: () => notImplemented("emit"),
  fixtures: [
    { name: "full-surface" },
    { name: "no-artifacts" },
    { name: "root-fallbacks" },
  ],
};

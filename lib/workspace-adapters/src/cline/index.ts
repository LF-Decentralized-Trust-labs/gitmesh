import type { AgentAdapter } from "../types.js";
import { detect } from "./detect.js";

export { detect, type ClineArtifact, type ClineArtifactKind } from "./detect.js";

function notImplemented(method: string): never {
  throw new Error(
    `cline adapter: ${method}() is not implemented yet - it lands with a post-launch pivot task`,
  );
}

/** The `cline` adapter. Only `detect()` is implemented (T1.6). */
export const clineAdapter: AgentAdapter = {
  name: "cline",
  version: "0.1.0",
  detect,
  importArtifacts: () => notImplemented("importArtifacts"),
  capabilities: () => notImplemented("capabilities"),
  plan: () => notImplemented("plan"),
  emit: () => notImplemented("emit"),
  fixtures: [
    { name: "legacy-single-file" },
    { name: "no-artifacts" },
    { name: "rules-directory" },
  ],
};

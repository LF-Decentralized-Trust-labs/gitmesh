import type { AgentAdapter } from "../types.js";
import { detect } from "./detect.js";

export { detect, type DevinArtifact, type DevinArtifactKind } from "./detect.js";

function notImplemented(method: string): never {
  throw new Error(
    `devin adapter: ${method}() is not implemented yet - it lands with a post-launch pivot task`,
  );
}

/** The `devin` (ex-Windsurf) adapter. Only `detect()` is implemented (T1.6). */
export const devinAdapter: AgentAdapter = {
  name: "devin",
  version: "0.1.0",
  detect,
  importArtifacts: () => notImplemented("importArtifacts"),
  capabilities: () => notImplemented("capabilities"),
  plan: () => notImplemented("plan"),
  emit: () => notImplemented("emit"),
  fixtures: [
    { name: "full-surface" },
    { name: "legacy-windsurfrules" },
    { name: "no-artifacts" },
  ],
};

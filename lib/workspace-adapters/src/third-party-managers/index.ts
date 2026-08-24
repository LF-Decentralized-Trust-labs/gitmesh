import type { AgentAdapter } from "../types.js";
import { detect } from "./detect.js";

export {
  COEXISTENCE_NOTE,
  detect,
  type ThirdPartyManagerArtifact,
  type ThirdPartyManagerArtifactKind,
} from "./detect.js";

function notImplemented(method: string): never {
  throw new Error(
    `third-party-managers adapter: ${method}() is not implemented - manager territory ` +
      "is detect-and-respect only (ADR-004); importers for ruler/rulesync/agents-json " +
      "land with pivot tasks T3.10/T3.11",
  );
}

/**
 * The `third-party-managers` adapter. Only `detect()` is implemented (T1.7);
 * `capabilities()` is honestly empty - manager territory never expresses
 * policy rules, so the coverage matrix (T7.3) has nothing to list here.
 */
export const thirdPartyManagersAdapter: AgentAdapter = {
  name: "third-party-managers",
  version: "0.1.0",
  detect,
  importArtifacts: () => notImplemented("importArtifacts"),
  capabilities: () => ({}),
  plan: () => notImplemented("plan"),
  emit: () => notImplemented("emit"),
  fixtures: [
    { name: "lockfiles-and-state" },
    { name: "no-artifacts" },
    { name: "ruler-managed" },
    { name: "symlink-managed" },
  ],
};

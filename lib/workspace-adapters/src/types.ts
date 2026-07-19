import type { WorkspaceIR } from "@gitmesh/workspace-core";

/** Repository context passed to adapter operations. */
export interface RepoContext {
  /** Absolute path to the repository root. */
  rootDir: string;
}

/**
 * An agent artifact found in a repository.
 * Minimal at this stage; extended by the E1 detector tasks (T1.1+).
 */
export interface DetectedArtifact {
  /** Repository-relative path of the artifact. */
  path: string;
}

/** How an adapter can express a policy rule at a given tier. */
export type CapabilityLevel = "native" | "hook" | "advisory" | "unsupported";

/**
 * Per policy-rule capability declaration, per tier (pivot.md §10.6).
 * The coverage matrix is generated from these flags (T7.2/T7.3).
 */
export interface CapabilityFlags {
  [ruleId: string]: {
    repo: CapabilityLevel;
    org: CapabilityLevel;
  };
}

/**
 * A write the adapter intends to make.
 * Minimal at this stage; the planner (T5.1) extends it with
 * create/update/no-op/blocked/lossy detail.
 */
export interface PlannedWrite {
  /** Repository-relative path of the file that would be written. */
  path: string;
}

/** A concrete file edit produced by `emit` (emitters land with E4). */
export interface FileEdit {
  /** Repository-relative path of the file to write. */
  path: string;
  /** Full file content to write. */
  content: string;
}

/**
 * Reference to a golden conformance fixture.
 * The byte-exact fixture harness lands with T0.5.
 */
export interface GoldenFixture {
  /** Fixture case name, unique within the adapter. */
  name: string;
}

/**
 * The adapter contract (pivot.md §10.6).
 *
 * One implementation per agent tool. Capability flags declare what each
 * adapter can and cannot express so the coverage matrix can never drift
 * from reality; `plan` is pure and lossy projections are always reported,
 * never silent.
 */
export interface AgentAdapter {
  /** Stable adapter name, e.g. "claude-code". */
  name: string;
  /** Adapter semver, recorded in `.gitmesh/lock.json`. */
  version: string;
  /** Inventory every artifact this adapter recognizes (doctor). */
  detect(repo: RepoContext): DetectedArtifact[];
  /** Import native artifacts into the workspace IR (init/migrate). */
  importArtifacts(repo: RepoContext): Partial<WorkspaceIR>;
  /** Declare per-rule, per-tier expressiveness. */
  capabilities(): CapabilityFlags;
  /** Pure planning pass; lossy projections listed. */
  plan(ir: WorkspaceIR): PlannedWrite[];
  /** Produce managed-marker-aware file edits. */
  emit(ir: WorkspaceIR): FileEdit[];
  /** Golden conformance fixtures for this adapter. */
  fixtures: GoldenFixture[];
}

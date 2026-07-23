import type { WorkspaceIR } from "@gitmesh/workspace-core";

/** Repository context passed to adapter operations. */
export interface RepoContext {
  /**
   * Absolute path to the repository root. Callers resolve the git root and
   * pass it here; detectors treat it as authoritative and never walk upward.
   */
  rootDir: string;
  /**
   * Include user-scope artifacts (files under the invoking user's home
   * directory, e.g. `~/.claude/CLAUDE.md`). Set by `doctor --user`; off by
   * default per the local-trust-boundary principle (pivot.md §10.1).
   */
  userScope?: boolean;
  /**
   * Home directory consulted for user-scope artifacts. Defaults to
   * `os.homedir()`; tests point it at a fixture directory.
   */
  homeDir?: string;
  /**
   * Absolute paths probed — for presence only — for org-managed Claude Code
   * settings. Defaults to the per-OS managed-settings locations; tests point
   * these at fixture paths. An empty array disables the probe.
   */
  managedSettingsPaths?: readonly string[];
}

/** Configuration tier an artifact belongs to. */
export type ArtifactScope = "managed" | "user" | "project" | "local";

/**
 * An agent artifact found by `detect()` (the doctor inventory). Extended by
 * the E1 detector tasks as they land (T1.1+); `kind` values are
 * adapter-specific and documented on each adapter.
 *
 * Paths are stable, POSIX-style display paths so detector output is
 * byte-identical across machines: repository-relative for `project`/`local`
 * artifacts, `~/`-prefixed for `user` artifacts, and a well-known basename
 * for `managed` presence probes (which report presence only, never content
 * or machine-specific locations).
 */
export interface DetectedArtifact {
  /** Stable POSIX-style path of the artifact (see interface docs). */
  path: string;
  /** Adapter-specific artifact kind, e.g. `"instructions"` or `"mcp-config"`. */
  kind: string;
  /** Configuration tier the artifact belongs to. */
  scope: ArtifactScope;
  /**
   * Literal symlink target (`/`-normalized) when the artifact file is itself
   * a symbolic link. Symlinked config is a healthy pattern (pivot.md §10.4):
   * it is inventoried as a link, never resolved away.
   */
  symlinkTarget?: string;
  /** True when the artifact is a symlink that does not resolve to a file. */
  broken?: boolean;
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

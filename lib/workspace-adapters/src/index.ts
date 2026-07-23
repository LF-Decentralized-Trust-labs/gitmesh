export type {
  AgentAdapter,
  ArtifactScope,
  CapabilityFlags,
  CapabilityLevel,
  DetectedArtifact,
  FileEdit,
  GoldenFixture,
  PlannedWrite,
  RepoContext,
} from "./types.js";
export {
  builtinAdapterLoaders,
  createAdapterRegistry,
  type AdapterLoader,
  type AdapterRegistry,
} from "./registry.js";
export {
  assertGoldenCase,
  listGoldenCases,
  readTreeAsGoldenOutputs,
  runGoldenCase,
  type GoldenCase,
  type GoldenDifference,
  type GoldenOutputFile,
  type GoldenResult,
  type GoldenRunner,
} from "./golden.js";

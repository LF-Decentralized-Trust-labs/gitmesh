import { createRequire } from "node:module";
import { Command } from "commander";
import { applyDataDirOverride, type DataDirOptionLike } from "./config/data-dir.js";
import { registerDoctorCommand } from "./workspace/doctor.js";

export type CliMode = "gitmesh" | "gitmesh-agents";

/**
 * Attaches the legacy GitMesh Agents command surface onto a parent command.
 * Injected by entry points instead of imported here so the published
 * `gitmesh-cli` bundle (entry src/gitmesh.ts) never reaches the legacy
 * command tree - and therefore ships no server, Drizzle, or Postgres code
 * (pivot §10.8, ADR-002). The monorepo dev entry (src/gitmesh-dev.ts) and
 * the gitmesh-agents entry (src/index.ts) inject the real registrar.
 */
export type LegacyRegistrar = (parent: Command) => void;

// Resolved at runtime relative to the executing entry (src/ in dev, dist/ in
// a published package), so `--version` always reports the manifest of the
// package actually installed - changeset bumps never leave it stale.
const CLI_VERSION: string = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;

const STUB_COMMANDS: ReadonlyArray<[name: string, description: string]> = [
  ["init", "Create .gitmesh/ workspace config from existing agent files"],
  ["migrate", "Migrate existing per-tool configs into the canonical source"],
  ["apply", "Compile canonical config to each agent's native files"],
  ["check", "Verify generated configs are in sync (CI drift gate)"],
  ["policy", "Manage policy packs and permission rules"],
];

/**
 * Builds the CLI program for one of the two entry points.
 *
 * `configure` runs on the fresh root before any subcommand is created -
 * commander copies exitOverride/configureOutput settings to subcommands at
 * `.command()` time, so tests must inject their overrides here.
 */
export function createProgram(
  mode: CliMode,
  configure?: (program: Command) => void,
  registerLegacy?: LegacyRegistrar,
): Command {
  const program = new Command();
  configure?.(program);

  program.hook("preAction", (_thisCommand, actionCommand) => {
    const options = actionCommand.optsWithGlobals() as DataDirOptionLike;
    const optionNames = new Set(actionCommand.options.map((option) => option.attributeName()));
    applyDataDirOverride(options, {
      hasConfigOption: optionNames.has("config"),
      hasContextOption: optionNames.has("context"),
    });
  });

  if (mode === "gitmesh-agents") {
    if (!registerLegacy) {
      throw new Error("gitmesh-agents mode requires a legacy registrar");
    }
    program
      .name("gitmesh-agents")
      .description("GitMesh Agents CLI - setup, diagnose, and configure your instance")
      .version(CLI_VERSION);
    registerLegacy(program);
    return program;
  }

  program
    .name("gitmesh")
    .description("GitMesh - audit and govern every coding agent from your repo")
    .version(CLI_VERSION);

  registerDoctorCommand(program);
  for (const [name, description] of STUB_COMMANDS) {
    program
      .command(name)
      .description(`${description} (not implemented yet)`)
      .action((_opts: unknown, cmd: Command) => {
        cmd.error(`gitmesh ${name}: not implemented yet`, { exitCode: 1 });
      });
  }

  if (registerLegacy) {
    const legacy = program
      .command("legacy")
      .description("Legacy GitMesh Agents server & orchestration commands (maintenance mode)");
    registerLegacy(legacy);
  } else {
    program
      .command("legacy")
      .description("Legacy GitMesh Agents server & orchestration commands (not included in this package)")
      .argument("[args...]")
      .allowUnknownOption()
      .action((_args: unknown, _opts: unknown, cmd: Command) => {
        cmd.error(
          "gitmesh legacy: the legacy GitMesh Agents commands are not included in the gitmesh-cli package.\n" +
            "Run them from a GitMesh repository checkout (pnpm gitmesh-agents ...) or install the gitmesh-agents package.",
          { exitCode: 1 },
        );
      });
  }

  return program;
}

export function runCli(mode: CliMode, registerLegacy?: LegacyRegistrar): void {
  createProgram(mode, undefined, registerLegacy)
    .parseAsync()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

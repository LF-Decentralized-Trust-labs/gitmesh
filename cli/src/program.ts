import { Command } from "commander";
import { registerLegacyCommands } from "./legacy.js";
import { applyDataDirOverride, type DataDirOptionLike } from "./config/data-dir.js";

export type CliMode = "gitmesh" | "gitmesh-agents";

const CLI_VERSION = "0.2.7";

const STUB_COMMANDS: ReadonlyArray<[name: string, description: string]> = [
  ["doctor", "Audit agent configuration across coding agents"],
  ["init", "Create .gitmesh/ workspace config from existing agent files"],
  ["migrate", "Migrate existing per-tool configs into the canonical source"],
  ["apply", "Compile canonical config to each agent's native files"],
  ["check", "Verify generated configs are in sync (CI drift gate)"],
  ["policy", "Manage policy packs and permission rules"],
];

/**
 * Builds the CLI program for one of the two entry points.
 *
 * `configure` runs on the fresh root before any subcommand is created —
 * commander copies exitOverride/configureOutput settings to subcommands at
 * `.command()` time, so tests must inject their overrides here.
 */
export function createProgram(
  mode: CliMode,
  configure?: (program: Command) => void,
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
    program
      .name("gitmesh-agents")
      .description("GitMesh Agents CLI — setup, diagnose, and configure your instance")
      .version(CLI_VERSION);
    registerLegacyCommands(program);
    return program;
  }

  program
    .name("gitmesh")
    .description("GitMesh — audit and govern every coding agent from your repo")
    .version(CLI_VERSION);

  for (const [name, description] of STUB_COMMANDS) {
    program
      .command(name)
      .description(`${description} (not implemented yet)`)
      .action((_opts: unknown, cmd: Command) => {
        cmd.error(`gitmesh ${name}: not implemented yet`, { exitCode: 1 });
      });
  }

  const legacy = program
    .command("legacy")
    .description("Legacy GitMesh Agents server & orchestration commands (maintenance mode)");
  registerLegacyCommands(legacy);

  return program;
}

export function runCli(mode: CliMode): void {
  createProgram(mode)
    .parseAsync()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

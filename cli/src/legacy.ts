import type { Command } from "commander";
import { setup } from "./commands/setup.js";
import { doctor } from "./commands/doctor.js";
import { envCommand } from "./commands/env.js";
import { configure } from "./commands/configure.js";
import { addAllowedHostname } from "./commands/allowed-hostname.js";
import { heartbeatRun } from "./commands/heartbeat-run.js";
import { runCommand } from "./commands/run.js";
import { bootstrapAdminInvite } from "./commands/auth-bootstrap-admin.js";
import { dbBackupCommand } from "./commands/db-backup.js";
import { registerContextCommands } from "./commands/client/context.js";
import { registerProjectCommands } from "./commands/client/project.js";
import { registerIssueCommands } from "./commands/client/issue.js";
import { registerAgentCommands } from "./commands/client/agent.js";
import { registerApprovalCommands } from "./commands/client/approval.js";
import { registerActivityCommands } from "./commands/client/activity.js";
import { registerDashboardCommands } from "./commands/client/dashboard.js";
import { registerInitCommand } from "./commands/init.js";
import { registerProjectConnectCommand } from "./commands/client/project-connect.js";
import { registerPolicyCommands } from "./commands/client/policy.js";
import { registerAuditCommands } from "./commands/client/audit.js";
import { registerAttestCommands } from "./commands/client/attest.js";

const DATA_DIR_OPTION_HELP =
  "GitMesh Agents data directory root (isolates state from ~/.gitmesh-agents)";

/**
 * Attaches the complete legacy GitMesh Agents command surface onto `parent`:
 * the root program in `gitmesh-agents` mode, or the `legacy` group in
 * `gitmesh` mode (pivot T0.3).
 */
export function registerLegacyCommands(parent: Command): void {
  parent
    .command("setup")
    .description("Interactive first-run setup wizard")
    .option("-c, --config <path>", "Path to config file")
    .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
    .option("-y, --yes", "Accept defaults (quickstart + start immediately)", false)
    .option("--run", "Start Gitmesh immediately after saving config", false)
    .action(setup);

  parent
    .command("doctor")
    .description("Run diagnostic checks on your GitMesh Agents setup")
    .option("-c, --config <path>", "Path to config file")
    .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
    .option("--repair", "Attempt to repair issues automatically")
    .alias("--fix")
    .option("-y, --yes", "Skip repair confirmation prompts")
    .action(async (opts) => {
      await doctor(opts);
    });

  parent
    .command("env")
    .description("Print environment variables for deployment")
    .option("-c, --config <path>", "Path to config file")
    .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
    .action(envCommand);

  parent
    .command("configure")
    .description("Update configuration sections")
    .option("-c, --config <path>", "Path to config file")
    .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
    .option("-s, --section <section>", "Section to configure (llm, database, logging, server, storage, secrets)")
    .action(configure);

  parent
    .command("db:backup")
    .description("Create a one-off database backup using current config")
    .option("-c, --config <path>", "Path to config file")
    .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
    .option("--dir <path>", "Backup output directory (overrides config)")
    .option("--retention-days <days>", "Retention window used for pruning", (value) => Number(value))
    .option("--filename-prefix <prefix>", "Backup filename prefix", "gitmesh-agents")
    .option("--json", "Print backup metadata as JSON")
    .action(async (opts) => {
      await dbBackupCommand(opts);
    });

  parent
    .command("allowed-hostname")
    .description("Allow a hostname for authenticated/private mode access")
    .argument("<host>", "Hostname to allow (for example dotta-macbook-pro)")
    .option("-c, --config <path>", "Path to config file")
    .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
    .action(addAllowedHostname);

  parent
    .command("run")
    .description("Bootstrap local setup (setup + doctor) and run Gitmesh")
    .option("-c, --config <path>", "Path to config file")
    .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
    .option("-i, --instance <id>", "Local instance id (default: default)")
    .option("--repair", "Attempt automatic repairs during doctor", true)
    .option("--no-repair", "Disable automatic repairs during doctor")
    .action(runCommand);

  const heartbeat = parent.command("heartbeat").description("Heartbeat utilities");

  heartbeat
    .command("run")
    .description("Run one agent heartbeat and stream live logs")
    .requiredOption("-a, --agent-id <agentId>", "Agent ID to invoke")
    .option("-c, --config <path>", "Path to config file")
    .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
    .option("--context <path>", "Path to CLI context file")
    .option("--profile <name>", "CLI context profile name")
    .option("--api-base <url>", "Base URL for the GitMesh Agents server API")
    .option("--api-key <token>", "Bearer token for agent-authenticated calls")
    .option(
      "--source <source>",
      "Invocation source (timer | assignment | on_demand | automation)",
      "on_demand",
    )
    .option("--trigger <trigger>", "Trigger detail (manual | ping | callback | system)", "manual")
    .option("--timeout-ms <ms>", "Max time to wait before giving up", "0")
    .option("--json", "Output raw JSON where applicable")
    .option("--debug", "Show raw adapter stdout/stderr JSON chunks")
    .action(heartbeatRun);

  registerContextCommands(parent);
  registerProjectCommands(parent);
  registerIssueCommands(parent);
  registerAgentCommands(parent);
  registerApprovalCommands(parent);
  registerActivityCommands(parent);
  registerDashboardCommands(parent);
  registerInitCommand(parent);
  registerProjectConnectCommand(parent);
  registerPolicyCommands(parent);
  registerAuditCommands(parent);
  registerAttestCommands(parent);

  const auth = parent.command("auth").description("Authentication and bootstrap utilities");

  auth
    .command("bootstrap-admin")
    .description("Create a one-time bootstrap invite URL for first instance admin")
    .option("-c, --config <path>", "Path to config file")
    .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
    .option("--force", "Create new invite even if admin already exists", false)
    .option("--expires-hours <hours>", "Invite expiration window in hours", (value) => Number(value))
    .option("--base-url <url>", "Public base URL used to print invite link")
    .action(bootstrapAdminInvite);
}

/**
 * `db:backup` — one-shot manual database backup.
 *
 * Restructured into a small set of pure resolvers + a thin imperative driver,
 * instead of the original interleaved option-parsing + side-effect block.
 */
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { formatDatabaseBackupResult, runDatabaseBackup } from "@gitmesh/data";
import {
  expandHomePrefix,
  resolveDefaultBackupDir,
  resolveGitmeshInstanceId,
} from "../config/home.js";
import type { GitmeshConfig } from "../config/schema.js";
import { readConfig, resolveConfigPath } from "../config/store.js";
import { printGitmeshCliBanner } from "../utils/banner.js";

interface DbBackupOptions {
  config?: string;
  dir?: string;
  retentionDays?: number;
  filenamePrefix?: string;
  json?: boolean;
}

interface ResolvedConnection {
  value: string;
  source: string;
}

interface ResolvedBackupPlan {
  connection: ResolvedConnection;
  backupDir: string;
  retentionDays: number;
  filenamePrefix: string;
  configPath: string;
}

const DEFAULT_FILENAME_PREFIX = "gitmesh-agents";
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_EMBEDDED_PORT = 54329;

// ---------------------------------------------------------------------------
// Pure resolvers
// ---------------------------------------------------------------------------

function resolveConnectionString(config: GitmeshConfig | null): ResolvedConnection {
  const envUrl = process.env.DATABASE_URL?.trim();
  if (envUrl) return { value: envUrl, source: "DATABASE_URL" };

  if (config?.database.mode === "postgres" && config.database.connectionString?.trim()) {
    return {
      value: config.database.connectionString.trim(),
      source: "config.database.connectionString",
    };
  }

  const port = config?.database.embeddedPostgresPort ?? DEFAULT_EMBEDDED_PORT;
  return {
    value: `postgres://gitmesh:gitmesh@127.0.0.1:${port}/gitmesh`,
    source: `embedded-postgres@${port}`,
  };
}

function normalizeRetentionDays(value: number | undefined, fallback: number): number {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < 1) {
    throw new Error(`Invalid retention days '${String(candidate)}'. Use a positive integer.`);
  }
  return candidate;
}

function expandBackupDir(raw: string): string {
  return path.resolve(expandHomePrefix(raw.trim()));
}

function resolveBackupPlan(opts: DbBackupOptions): ResolvedBackupPlan {
  const configPath = resolveConfigPath(opts.config);
  const config = readConfig(opts.config);
  const connection = resolveConnectionString(config);
  const defaultDir = resolveDefaultBackupDir(resolveGitmeshInstanceId());
  const configuredDir = opts.dir?.trim() || config?.database.backup.dir || defaultDir;

  return {
    connection,
    backupDir: expandBackupDir(configuredDir),
    retentionDays: normalizeRetentionDays(
      opts.retentionDays,
      config?.database.backup.retentionDays ?? DEFAULT_RETENTION_DAYS,
    ),
    filenamePrefix: opts.filenamePrefix?.trim() || DEFAULT_FILENAME_PREFIX,
    configPath,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function logPlan(plan: ResolvedBackupPlan): void {
  p.log.message(pc.dim(`Config: ${plan.configPath}`));
  p.log.message(pc.dim(`Connection source: ${plan.connection.source}`));
  p.log.message(pc.dim(`Backup dir: ${plan.backupDir}`));
  p.log.message(pc.dim(`Retention: ${plan.retentionDays} day(s)`));
}

function emitJsonResult(plan: ResolvedBackupPlan, result: { backupFile: string; sizeBytes: number; prunedCount: number }): void {
  console.log(
    JSON.stringify(
      {
        backupFile: result.backupFile,
        sizeBytes: result.sizeBytes,
        prunedCount: result.prunedCount,
        backupDir: plan.backupDir,
        retentionDays: plan.retentionDays,
        connectionSource: plan.connection.source,
      },
      null,
      2,
    ),
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function dbBackupCommand(opts: DbBackupOptions): Promise<void> {
  printGitmeshCliBanner();
  p.intro(pc.bgCyan(pc.black(" gitmesh-agents db:backup ")));

  const plan = resolveBackupPlan(opts);
  logPlan(plan);

  const spinner = p.spinner();
  spinner.start("Creating database backup...");
  try {
    const result = await runDatabaseBackup({
      connectionString: plan.connection.value,
      backupDir: plan.backupDir,
      retentionDays: plan.retentionDays,
      filenamePrefix: plan.filenamePrefix,
    });
    spinner.stop(`Backup saved: ${formatDatabaseBackupResult(result)}`);

    if (opts.json) {
      emitJsonResult(plan, result);
    }
    p.outro(pc.green("Backup completed."));
  } catch (err) {
    spinner.stop(pc.red("Backup failed."));
    throw err;
  }
}

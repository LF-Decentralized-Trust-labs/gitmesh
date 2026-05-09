/**
 * `auth bootstrap-admin` — mint a single-use bootstrap-admin invite for an
 * authenticated-mode deployment.
 *
 * Restructured into focused helpers (URL resolver / token mint / invite
 * row creation) so the entry point reads as a flat sequence of validate →
 * resolve → mutate → report steps.
 */
import { createHash, randomBytes } from "node:crypto";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { and, eq, gt, isNull } from "drizzle-orm";
import { createDb, instanceUserRoles, invites } from "@gitmesh/data";
import type { GitmeshConfig } from "../config/schema.js";
import { readConfig, resolveConfigPath } from "../config/store.js";

const DEFAULT_EXPIRY_HOURS = 72;
const MAX_EXPIRY_HOURS = 24 * 30;
const MIN_EXPIRY_HOURS = 1;
const DEFAULT_EMBEDDED_PORT = 54329;

interface BootstrapOpts {
  config?: string;
  force?: boolean;
  expiresHours?: number;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Token / hash helpers
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createInviteToken(): string {
  return `gmesh_bootstrap_${randomBytes(24).toString("hex")}`;
}

function clampExpiryHours(value: number | undefined): number {
  return Math.max(MIN_EXPIRY_HOURS, Math.min(MAX_EXPIRY_HOURS, value ?? DEFAULT_EXPIRY_HOURS));
}

// ---------------------------------------------------------------------------
// URL/connection resolvers
// ---------------------------------------------------------------------------

function resolveDbUrl(config: GitmeshConfig | null): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (config?.database.mode === "postgres" && config.database.connectionString) {
    return config.database.connectionString;
  }
  if (config?.database.mode === "embedded-postgres") {
    const port = config.database.embeddedPostgresPort ?? DEFAULT_EMBEDDED_PORT;
    return `postgres://gitmesh:gitmesh@127.0.0.1:${port}/gitmesh`;
  }
  return null;
}

function publicUrlFromEnv(): string | null {
  const candidate =
    process.env.GITMESH_PUBLIC_URL ??
    process.env.GITMESH_AUTH_PUBLIC_BASE_URL ??
    process.env.BETTER_AUTH_URL ??
    process.env.BETTER_AUTH_BASE_URL;
  return candidate?.trim() ? candidate.trim().replace(/\/+$/, "") : null;
}

function publicUrlFromConfig(config: GitmeshConfig | null): string | null {
  if (config?.auth.baseUrlMode === "explicit" && config.auth.publicBaseUrl) {
    return config.auth.publicBaseUrl.replace(/\/+$/, "");
  }
  return null;
}

function publicUrlFallback(config: GitmeshConfig | null): string {
  const host = config?.server.host ?? "localhost";
  const port = config?.server.port ?? 3100;
  const publicHost = host === "0.0.0.0" ? "localhost" : host;
  return `http://${publicHost}:${port}`;
}

function resolveBaseUrl(config: GitmeshConfig | null, explicitBaseUrl?: string): string {
  if (explicitBaseUrl) return explicitBaseUrl.replace(/\/+$/, "");
  return publicUrlFromEnv() ?? publicUrlFromConfig(config) ?? publicUrlFallback(config);
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

async function countAdmins(db: ReturnType<typeof createDb>): Promise<number> {
  const rows = await db
    .select()
    .from(instanceUserRoles)
    .where(eq(instanceUserRoles.role, "instance_admin"));
  return rows.length;
}

async function revokeOpenBootstrapInvites(
  db: ReturnType<typeof createDb>,
  now: Date,
): Promise<void> {
  await db
    .update(invites)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(invites.inviteType, "bootstrap_admin"),
        isNull(invites.revokedAt),
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, now),
      ),
    );
}

async function insertBootstrapInvite(
  db: ReturnType<typeof createDb>,
  token: string,
  expiresHours: number,
) {
  return db
    .insert(invites)
    .values({
      inviteType: "bootstrap_admin",
      tokenHash: hashToken(token),
      allowedJoinTypes: "human",
      expiresAt: new Date(Date.now() + expiresHours * 60 * 60 * 1000),
      invitedByUserId: "system",
    })
    .returning()
    .then((rows) => rows[0]);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function bootstrapAdminInvite(opts: BootstrapOpts): Promise<void> {
  const configPath = resolveConfigPath(opts.config);
  const config = readConfig(configPath);
  if (!config) {
    p.log.error(`No config found at ${configPath}. Run ${pc.cyan("gitmesh-agents setup")} first.`);
    return;
  }

  if (config.server.deploymentMode !== "authenticated") {
    p.log.info(
      "Deployment mode is local_trusted. Bootstrap admin invite is only required for authenticated mode.",
    );
    return;
  }

  const dbUrl = resolveDbUrl(config);
  if (!dbUrl) {
    p.log.error("Could not resolve database connection for bootstrap.");
    return;
  }

  const db = createDb(dbUrl);
  try {
    const adminCount = await countAdmins(db);
    if (adminCount > 0 && !opts.force) {
      p.log.info(
        "Instance already has an admin user. Use --force to generate a new bootstrap invite.",
      );
      return;
    }

    const now = new Date();
    await revokeOpenBootstrapInvites(db, now);

    const token = createInviteToken();
    const expiresHours = clampExpiryHours(opts.expiresHours);
    const created = await insertBootstrapInvite(db, token, expiresHours);

    const baseUrl = resolveBaseUrl(config, opts.baseUrl);
    const inviteUrl = `${baseUrl}/invite/${token}`;
    p.log.success("Created bootstrap admin invite.");
    p.log.message(`Invite URL: ${pc.cyan(inviteUrl)}`);
    p.log.message(`Expires: ${pc.dim(created.expiresAt.toISOString())}`);
  } catch (err) {
    p.log.error(
      `Could not create bootstrap invite: ${err instanceof Error ? err.message : String(err)}`,
    );
    p.log.info(
      "If using embedded-postgres, start the GitMesh Agents server and run this command again.",
    );
  }
}

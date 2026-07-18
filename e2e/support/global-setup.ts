import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type FullConfig } from "@playwright/test";
import { resolveE2EEnvironment } from "./environment.js";

const START_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 15_000;

const inheritedEnvKeys = [
  "CI",
  "ComSpec",
  "FORCE_COLOR",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "WINDIR",
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function killEmbeddedPostgres(instanceRoot: string): Promise<void> {
  const postmasterPidPath = path.join(instanceRoot, "db", "postmaster.pid");
  let postmasterPid: number;
  try {
    const contents = await readFile(postmasterPidPath, "utf8");
    postmasterPid = Number(contents.split(/\r?\n/, 1)[0]);
  } catch {
    return;
  }
  if (!Number.isInteger(postmasterPid) || postmasterPid <= 1) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(postmasterPid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(postmasterPid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}

async function removeDisposableHome(home: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(home, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(200 * (attempt + 1));
    }
  }
  throw lastError;
}

async function waitForHealth(baseURL: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `GitMesh E2E server exited before becoming healthy ` +
          `(code=${child.exitCode ?? "none"}, signal=${child.signalCode ?? "none"})`,
      );
    }
    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok) {
        const payload = (await response.json()) as { status?: unknown };
        if (payload.status === "ok") return;
      }
      lastError = new Error(`Health endpoint returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `GitMesh E2E server did not become healthy within ${START_TIMEOUT_MS}ms: ` +
      `${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function warmUI(baseURL: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
    await page.waitForTimeout(1_000);
    await context.close();
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  const { baseURL, home, instanceRoot, port } = resolveE2EEnvironment();
  await removeDisposableHome(home);

  const supportDir = path.dirname(fileURLToPath(import.meta.url));
  const serverDir = path.resolve(supportDir, "../../server");
  const tsxCli = path.join(serverDir, "node_modules", "tsx", "dist", "cli.mjs");
  const childEnv = Object.fromEntries(
    inheritedEnvKeys.flatMap((key) => {
      const value = process.env[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );
  const child = spawn(process.execPath, [tsxCli, "src/index.ts"], {
    cwd: serverDir,
    detached: process.platform !== "win32",
    env: {
      ...childEnv,
      DATABASE_URL: "",
      GITMESH_CONFIG: path.join(instanceRoot, "gitmesh-agents.json"),
      GITMESH_DB_BACKUP_DIR: path.join(instanceRoot, "data", "backups"),
      GITMESH_DB_BACKUP_ENABLED: "false",
      GITMESH_DEPLOYMENT_EXPOSURE: "private",
      GITMESH_DEPLOYMENT_MODE: "local_trusted",
      GITMESH_DISABLE_WORKSPACE_ENV: "true",
      GITMESH_HOME: home,
      GITMESH_INSTANCE_ID: "playwright",
      GITMESH_LOG_DIR: path.join(instanceRoot, "logs"),
      GITMESH_MIGRATION_PROMPT: "never",
      GITMESH_OPEN_ON_LISTEN: "false",
      GITMESH_SECRETS_MASTER_KEY_FILE: path.join(instanceRoot, "secrets", "master.key"),
      GITMESH_SECRETS_PROVIDER: "local_encrypted",
      GITMESH_SECRETS_STRICT_MODE: "true",
      GITMESH_STORAGE_LOCAL_DIR: path.join(instanceRoot, "data", "storage"),
      GITMESH_STORAGE_PROVIDER: "local_disk",
      GITMESH_UI_DEV_MIDDLEWARE: "true",
      HEARTBEAT_SCHEDULER_ENABLED: "false",
      HOME: home,
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      PORT: String(port),
      RUN_LOG_BASE_PATH: path.join(instanceRoot, "data", "run-logs"),
      USERPROFILE: home,
      XDG_CACHE_HOME: path.join(home, ".cache"),
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_DATA_HOME: path.join(home, ".local", "share"),
    },
    stdio: "inherit",
  });

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;

    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32") {
        killProcessTree(child);
        await waitForExit(child, 5_000);
      } else {
        child.kill("SIGTERM");
        if (!(await waitForExit(child, STOP_TIMEOUT_MS))) {
          killProcessTree(child);
          await waitForExit(child, 5_000);
        }
      }
    }
    await killEmbeddedPostgres(instanceRoot);
    await removeDisposableHome(home);
  };

  try {
    await waitForHealth(baseURL, child);
    await warmUI(baseURL);
  } catch (error) {
    await cleanup();
    throw error;
  }

  return cleanup;
}
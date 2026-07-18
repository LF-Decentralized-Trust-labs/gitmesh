import os from "node:os";
import path from "node:path";

export interface E2EEnvironment {
  baseURL: string;
  home: string;
  instanceRoot: string;
  port: number;
}

export function resolveE2EEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): E2EEnvironment {
  const port = env.GITMESH_E2E_PORT === undefined ? 3210 : Number(env.GITMESH_E2E_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("GITMESH_E2E_PORT must be an integer between 1024 and 65535");
  }

  const defaultHome = path.join(os.tmpdir(), `gitmesh-agents-playwright-${port}`);
  const home = path.resolve(env.GITMESH_E2E_HOME?.trim() || defaultHome);
  const tempRoot = path.resolve(os.tmpdir());
  const isTempChild = home.startsWith(`${tempRoot}${path.sep}`);
  const hasSafeName = path.basename(home).startsWith("gitmesh-agents-playwright-");
  if (!isTempChild || !hasSafeName) {
    throw new Error(
      `Refusing to manage unsafe E2E home: ${home}. ` +
        "Use a gitmesh-agents-playwright-* directory under the OS temp directory.",
    );
  }

  return {
    baseURL: `http://127.0.0.1:${port}`,
    home,
    instanceRoot: path.join(home, "instances", "playwright"),
    port,
  };
}
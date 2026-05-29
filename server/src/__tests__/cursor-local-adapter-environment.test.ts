import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { testEnvironment } from "@gitmesh/adapter-cursor-local/server";
import {
  assertAdapterEnvironment,
  runEnvironmentCase,
  type EnvironmentScenario,
} from "./_helpers/adapter-test-harness.js";

async function writeFakeAgentCommand(binDir: string): Promise<string> {
  const isWindows = process.platform === "win32";

  const jsPath = path.join(binDir, "agent.js");
  const jsScript = `
const fs = require("node:fs");
const outPath = process.env.GITMESH_TEST_ARGS_PATH;
if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(process.argv.slice(2)), "utf8");
}
console.log(JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "output_text", text: "hello" }] },
}));
console.log(JSON.stringify({
  type: "result",
  subtype: "success",
  result: "hello",
}));
`;
  await fs.writeFile(jsPath, jsScript, "utf8");

  if (isWindows) {
    // On Windows, create agent.cmd that delegates to agent.js
    const cmdPath = path.join(binDir, "agent.cmd");
    await fs.writeFile(cmdPath, `@echo off\nnode "%~dp0agent.js" %*\n`, "utf8");
    return cmdPath;
  } else {
    const commandPath = path.join(binDir, "agent");
    await fs.writeFile(commandPath, `#!/usr/bin/env node\n` + jsScript, "utf8");
    await fs.chmod(commandPath, 0o755);
    return commandPath;
  }
}

interface CursorEnvCtx {
  cwd?: string;
  argsPath?: string;
  rootDir?: string;
}

const scenarios: EnvironmentScenario<CursorEnvCtx>[] = [
  {
    name: "creates a missing working directory when cwd is absolute",
    arrange: async () => {
      const cwd = path.join(
        os.tmpdir(),
        `gitmesh-agents-cursor-local-cwd-${Date.now()}-${Math.random()
          .toString(16)
          .slice(2)}`,
        "workspace",
      );
      await fs.rm(path.dirname(cwd), { recursive: true, force: true });
      return {
        config: {
          projectId: "project-1",
          adapterType: "cursor",
          config: { command: process.execPath, cwd },
        },
        ctx: { cwd },
        cleanup: async () => {
          await fs.rm(path.dirname(cwd), { recursive: true, force: true });
        },
      };
    },
    expect: (result) => {
      assertAdapterEnvironment(result, {
        codes: ["cursor_cwd_valid"],
        forbidErrorLevel: true,
      });
    },
    postAssert: async ({ cwd }) => {
      const stats = await fs.stat(cwd as string);
      expect(stats.isDirectory()).toBe(true);
    },
  },
  {
    name: "adds --yolo to hello probe args by default",
    arrange: async () => {
      const root = path.join(
        os.tmpdir(),
        `gitmesh-agents-cursor-local-probe-${Date.now()}-${Math.random()
          .toString(16)
          .slice(2)}`,
      );
      const binDir = path.join(root, "bin");
      const cwd = path.join(root, "workspace");
      const argsPath = path.join(root, "args.json");
      await fs.mkdir(binDir, { recursive: true });
      await writeFakeAgentCommand(binDir);
      return {
        config: {
          projectId: "project-1",
          adapterType: "cursor",
          config: {
            command: "agent",
            cwd,
            env: {
              CURSOR_API_KEY: "test-key",
              GITMESH_TEST_ARGS_PATH: argsPath,
              PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
            },
          },
        },
        ctx: { argsPath, rootDir: root },
        cleanup: async () => {
          await fs.rm(root, { recursive: true, force: true });
        },
      };
    },
    expect: (result) => {
      assertAdapterEnvironment(result, { status: "pass" });
    },
    postAssert: async ({ argsPath }) => {
      const args = JSON.parse(await fs.readFile(argsPath as string, "utf8")) as string[];
      expect(args).toContain("--yolo");
    },
  },
  {
    name: "does not auto-add --yolo when extraArgs already bypass trust",
    arrange: async () => {
      const root = path.join(
        os.tmpdir(),
        `gitmesh-agents-cursor-local-probe-extra-${Date.now()}-${Math.random()
          .toString(16)
          .slice(2)}`,
      );
      const binDir = path.join(root, "bin");
      const cwd = path.join(root, "workspace");
      const argsPath = path.join(root, "args.json");
      await fs.mkdir(binDir, { recursive: true });
      await writeFakeAgentCommand(binDir);
      return {
        config: {
          projectId: "project-1",
          adapterType: "cursor",
          config: {
            command: "agent",
            cwd,
            extraArgs: ["--yolo"],
            env: {
              CURSOR_API_KEY: "test-key",
              GITMESH_TEST_ARGS_PATH: argsPath,
              PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
            },
          },
        },
        ctx: { argsPath, rootDir: root },
        cleanup: async () => {
          await fs.rm(root, { recursive: true, force: true });
        },
      };
    },
    expect: (result) => {
      assertAdapterEnvironment(result, { status: "pass" });
    },
    postAssert: async ({ argsPath }) => {
      const args = JSON.parse(await fs.readFile(argsPath as string, "utf8")) as string[];
      expect(args).toContain("--yolo");
      expect(args).not.toContain("--trust");
    },
  },
];

describe("cursor environment diagnostics", () => {
  it.each(scenarios)("$name", async (scenario) => {
    await runEnvironmentCase(
      (config) => testEnvironment(config as Parameters<typeof testEnvironment>[0]),
      scenario,
    );
  });
});

import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute } from "@gitmesh/adapter-cursor-local/server";

async function writeFakeCursorCommand(
  commandPath: string,
  capturePath: string,
): Promise<void> {
  const nodeScript = `#!/usr/bin/env node
const fs = require("node:fs");

let stdin = "";
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});

process.stdin.on("end", () => {
  const capturePath = process.env.GITMESH_TEST_CAPTURE_PATH;
  const payload = {
    argv: process.argv.slice(2),
    prompt: stdin,
    gitmeshAgentsEnvKeys: Object.keys(process.env)
      .filter((key) => key.startsWith("GITMESH_"))
      .sort(),
  };
  if (capturePath) {
    fs.writeFileSync(capturePath, JSON.stringify(payload, null, 2), "utf8");
  }
  console.log(JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "cursor-session-1",
    model: "auto",
  }));
  console.log(JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "output_text", text: "hello" }] },
  }));
  console.log(JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: "cursor-session-1",
    result: "ok",
  }));
});
`;

  if (process.platform === "win32") {
    const dir = path.dirname(commandPath);
    const scriptPath = path.join(dir, "agent");
    await fs.writeFile(scriptPath, nodeScript, "utf8");
    await fs.writeFile(
      commandPath,
      `@echo off
set "GITMESH_TEST_CAPTURE_PATH=${capturePath}"
node "%~dp0agent" %*
`,
      "utf8",
    );
  } else {
    await fs.writeFile(commandPath, nodeScript, { encoding: "utf8", mode: 0o755 });
  }
}

type CapturePayload = {
  argv: string[];
  prompt: string;
  gitmeshAgentsEnvKeys: string[];
};

describe("cursor execute", () => {
  it("injects gitmesh-agents env vars and prompt note by default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gitmesh-agents-cursor-execute-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(
      root,
      process.platform === "win32" ? "agent.cmd" : "agent",
    );
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeCursorCommand(commandPath, capturePath);

    const previousHome = process.env.HOME;
    process.env.HOME = root;

    let invocationPrompt = "";
    try {
      const result = await execute({
        runId: "run-1",
        agent: {
          id: "agent-1",
          projectId: "project-1",
          name: "Cursor Coder",
          role: null,
          adapterType: "cursor",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          model: "auto",
          env: {
            GITMESH_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the gitmesh-agents heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async (meta) => {
          invocationPrompt = meta.prompt ?? "";
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.argv).not.toContain("Follow the gitmesh-agents heartbeat.");
      expect(capture.argv).not.toContain("--mode");
      expect(capture.argv).not.toContain("ask");
      expect(capture.gitmeshAgentsEnvKeys).toEqual(
        expect.arrayContaining([
          "GITMESH_AGENT_ID",
          "GITMESH_API_KEY",
          "GITMESH_API_URL",
          "GITMESH_PROJECT_ID",
          "GITMESH_RUN_ID",
        ]),
      );
      expect(capture.prompt).toContain("GitMesh Agents runtime note:");
      expect(capture.prompt).toContain("GITMESH_API_KEY");
      expect(invocationPrompt).toContain("GitMesh Agents runtime note:");
      expect(invocationPrompt).toContain("GITMESH_API_URL");
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("passes --mode when explicitly configured", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gitmesh-agents-cursor-execute-mode-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(
      root,
      process.platform === "win32" ? "agent.cmd" : "agent",
    );
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeCursorCommand(commandPath, capturePath);

    const previousHome = process.env.HOME;
    process.env.HOME = root;

    try {
      const result = await execute({
        runId: "run-2",
        agent: {
          id: "agent-1",
          projectId: "project-1",
          name: "Cursor Coder",
          role: null,
          adapterType: "cursor",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          model: "auto",
          mode: "ask",
          env: {
            GITMESH_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the gitmesh-agents heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.argv).toContain("--mode");
      expect(capture.argv).toContain("ask");
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

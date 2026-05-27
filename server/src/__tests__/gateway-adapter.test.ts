import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { execute, testEnvironment } from "@gitmesh/adapter-gateway/server";
import { parseGatewayStdoutLine } from "@gitmesh/adapter-gateway/ui";
import type { AdapterExecutionContext } from "@gitmesh/adapter-sdk";
import {
  defineAdapterScenarios,
  runAdapterCase,
  type AdapterScenario,
} from "./_helpers/adapter-test-harness.js";

// ---------------------------------------------------------------------------
// Context + mock-server builders
// ---------------------------------------------------------------------------

function buildContext(
  config: Record<string, unknown>,
  overrides?: Partial<AdapterExecutionContext>,
): AdapterExecutionContext {
  return {
    runId: "run-123",
    agent: {
      id: "agent-123",
      projectId: "project-123",
      name: "Gateway Gateway Agent",
      role: null,
      adapterType: "gateway",
      adapterConfig: {},
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: null,
    },
    config,
    context: {
      taskId: "task-123",
      issueId: "issue-123",
      wakeReason: "issue_assigned",
      issueIds: ["issue-123"],
    },
    onLog: async () => {},
    ...overrides,
  };
}

interface MockGateway {
  url: string;
  getAgentPayload: () => Record<string, unknown> | null;
  close: () => Promise<void>;
}

type GatewayVariant = "plain" | "pairing";

async function createMockGateway(variant: GatewayVariant): Promise<MockGateway> {
  const server = createServer();
  const wss = new WebSocketServer({ server });

  let agentPayload: Record<string, unknown> | null = null;
  let approved = false;
  const pendingRequestId = "req-1";
  let lastSeenDeviceId: string | null = null;

  wss.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: "nonce-123" },
      }),
    );

    socket.on("message", (raw) => {
      const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
      const frame = JSON.parse(text) as {
        type: string;
        id: string;
        method: string;
        params?: Record<string, unknown>;
      };
      if (frame.type !== "req") return;

      if (frame.method === "connect") {
        if (variant === "pairing") {
          const device = frame.params?.device as Record<string, unknown> | undefined;
          const deviceId = typeof device?.id === "string" ? device.id : null;
          if (deviceId) lastSeenDeviceId = deviceId;
          if (deviceId && !approved) {
            socket.send(
              JSON.stringify({
                type: "res",
                id: frame.id,
                ok: false,
                error: {
                  code: "NOT_PAIRED",
                  message: "pairing required",
                  details: {
                    code: "PAIRING_REQUIRED",
                    requestId: pendingRequestId,
                    reason: "not-paired",
                  },
                },
              }),
            );
            socket.close(1008, "pairing required");
            return;
          }
        }
        socket.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: true,
            payload: {
              type: "hello-ok",
              protocol: 3,
              server: { version: "test", connId: "conn-1" },
              features: {
                methods:
                  variant === "pairing"
                    ? [
                        "connect",
                        "agent",
                        "agent.wait",
                        "device.pair.list",
                        "device.pair.approve",
                      ]
                    : ["connect", "agent", "agent.wait"],
                events: ["agent"],
              },
              snapshot: { version: 1, ts: Date.now() },
              policy: {
                maxPayload: 1_000_000,
                maxBufferedBytes: 1_000_000,
                tickIntervalMs: 30_000,
              },
            },
          }),
        );
        return;
      }

      if (frame.method === "device.pair.list") {
        socket.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: true,
            payload: {
              pending: approved
                ? []
                : [
                    {
                      requestId: pendingRequestId,
                      deviceId: lastSeenDeviceId ?? "device-unknown",
                    },
                  ],
              paired:
                approved && lastSeenDeviceId
                  ? [{ deviceId: lastSeenDeviceId }]
                  : [],
            },
          }),
        );
        return;
      }

      if (frame.method === "device.pair.approve") {
        const requestId = frame.params?.requestId;
        if (requestId !== pendingRequestId) {
          socket.send(
            JSON.stringify({
              type: "res",
              id: frame.id,
              ok: false,
              error: { code: "INVALID_REQUEST", message: "unknown requestId" },
            }),
          );
          return;
        }
        approved = true;
        socket.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: true,
            payload: {
              requestId: pendingRequestId,
              device: { deviceId: lastSeenDeviceId ?? "device-unknown" },
            },
          }),
        );
        return;
      }

      if (frame.method === "agent") {
        agentPayload = frame.params ?? null;
        const runId =
          typeof frame.params?.idempotencyKey === "string"
            ? frame.params.idempotencyKey
            : "run-123";

        socket.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: true,
            payload: { runId, status: "accepted", acceptedAt: Date.now() },
          }),
        );

        if (variant === "plain") {
          socket.send(
            JSON.stringify({
              type: "event",
              event: "agent",
              payload: {
                runId,
                seq: 1,
                stream: "assistant",
                ts: Date.now(),
                data: { delta: "cha" },
              },
            }),
          );
          socket.send(
            JSON.stringify({
              type: "event",
              event: "agent",
              payload: {
                runId,
                seq: 2,
                stream: "assistant",
                ts: Date.now(),
                data: { delta: "chacha" },
              },
            }),
          );
        } else {
          socket.send(
            JSON.stringify({
              type: "event",
              event: "agent",
              payload: {
                runId,
                seq: 1,
                stream: "assistant",
                ts: Date.now(),
                data: { delta: "ok" },
              },
            }),
          );
        }
        return;
      }

      if (frame.method === "agent.wait") {
        socket.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: true,
            payload: {
              runId: frame.params?.runId,
              status: "ok",
              startedAt: 1,
              endedAt: 2,
            },
          }),
        );
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address");
  }

  return {
    url: `ws://127.0.0.1:${address.port}`,
    getAgentPayload: () => agentPayload,
    close: async () => {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ---------------------------------------------------------------------------
// Scenario lists
// ---------------------------------------------------------------------------

const stdoutParserScenarios: AdapterScenario[] = defineAdapterScenarios([
  {
    kind: "parser",
    name: "parses assistant deltas from gateway event lines",
    run: (input) => {
      const ts = "2026-03-06T15:00:00.000Z";
      return parseGatewayStdoutLine(input as string, ts);
    },
    input: '[gateway:event] run=run-1 stream=assistant data={"delta":"hello"}',
    expect: [
      {
        kind: "assistant",
        ts: "2026-03-06T15:00:00.000Z",
        text: "hello",
        delta: true,
      },
    ],
  },
]);

interface GatewayExecuteScenario {
  name: string;
  variant: GatewayVariant;
  /** Verifies the result + recorded mock state. */
  verify: (args: {
    result: Awaited<ReturnType<typeof execute>>;
    logs: string[];
    payload: Record<string, unknown> | null;
  }) => void;
}

const executeScenarios: GatewayExecuteScenario[] = [
  {
    name: "runs connect -> agent -> agent.wait and forwards wake payload",
    variant: "plain",
    verify: ({ result, logs, payload }) => {
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(result.summary).toContain("chachacha");
      expect(result.provider).toBe("gateway");
      expect(payload).toBeTruthy();
      expect(payload?.idempotencyKey).toBe("run-123");
      expect(payload?.sessionKey).toBe("gitmesh-agents:issue:issue-123");
      expect(String(payload?.message ?? "")).toContain("wake now");
      expect(String(payload?.message ?? "")).toContain("GITMESH_RUN_ID=run-123");
      expect(String(payload?.message ?? "")).toContain("GITMESH_TASK_ID=task-123");
      expect(
        logs.some((entry) =>
          entry.includes("[gateway:event] run=run-123 stream=assistant"),
        ),
      ).toBe(true);
    },
  },
  {
    name: "auto-approves pairing once and retries the run",
    variant: "pairing",
    verify: ({ result, logs, payload }) => {
      expect(result.exitCode).toBe(0);
      expect(result.summary).toContain("ok");
      expect(
        logs.some((entry) =>
          entry.includes(
            "pairing required; attempting automatic pairing approval",
          ),
        ),
      ).toBe(true);
      expect(
        logs.some((entry) => entry.includes("auto-approved pairing request")),
      ).toBe(true);
      expect(payload).toBeTruthy();
    },
  },
];

afterEach(() => {
  // no global mocks
});

describe("gateway adapter ui stdout parser", () => {
  it.each(stdoutParserScenarios)("$name", runAdapterCase);
});

describe("gateway adapter adapter execute", () => {
  it.each(executeScenarios)("$name", async (scenario) => {
    const gateway = await createMockGateway(scenario.variant);
    const logs: string[] = [];
    try {
      const result = await execute(
        buildContext(
          {
            url: gateway.url,
            headers: { "x-gateway-token": "gateway-token" },
            payloadTemplate: { message: "wake now" },
            waitTimeoutMs: 2000,
          },
          {
            onLog: async (_stream, chunk) => {
              logs.push(chunk);
            },
          },
        ),
      );
      scenario.verify({ result, logs, payload: gateway.getAgentPayload() });
    } finally {
      await gateway.close();
    }
  });

  it("fails fast when url is missing", async () => {
    const result = await execute(buildContext({}));
    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("gateway_url_missing");
  });
});

describe("gateway adapter testEnvironment", () => {
  it("reports missing url as failure", async () => {
    const result = await testEnvironment({
      projectId: "project-123",
      adapterType: "gateway",
      config: {},
    });
    expect(result.status).toBe("fail");
    expect(
      result.checks.some((check) => check.code === "gateway_url_missing"),
    ).toBe(true);
  });
});

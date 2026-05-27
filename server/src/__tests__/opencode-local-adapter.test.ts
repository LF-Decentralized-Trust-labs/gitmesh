import { describe, it } from "vitest";
import {
  isOpenCodeUnknownSessionError,
  parseOpenCodeJsonl,
} from "@gitmesh/adapter-opencode-local/server";
import { parseOpenCodeStdoutLine } from "@gitmesh/adapter-opencode-local/ui";
import { printOpenCodeStreamEvent } from "@gitmesh/adapter-opencode-local/cli";
import { expect } from "vitest";
import {
  defineAdapterScenarios,
  runAdapterCase,
  type AdapterScenario,
} from "./_helpers/adapter-test-harness.js";

const TS = "2026-03-04T00:00:00.000Z";

const parserScenarios: AdapterScenario[] = defineAdapterScenarios([
  {
    kind: "parser",
    name: "extracts session, summary, usage, cost, and terminal error message",
    run: (input) => parseOpenCodeJsonl(input as string),
    input: [
      JSON.stringify({ type: "step_start", sessionID: "ses_123" }),
      JSON.stringify({ type: "text", part: { type: "text", text: "hello" } }),
      JSON.stringify({
        type: "step_finish",
        part: {
          reason: "tool-calls",
          cost: 0.001,
          tokens: { input: 100, output: 40, cache: { read: 20, write: 0 } },
        },
      }),
      JSON.stringify({
        type: "step_finish",
        part: {
          reason: "stop",
          cost: 0.002,
          tokens: { input: 50, output: 25, cache: { read: 10, write: 0 } },
        },
      }),
      JSON.stringify({ type: "error", message: "model access denied" }),
    ].join("\n"),
    expect: (actual: unknown) => {
      const parsed = actual as ReturnType<typeof parseOpenCodeJsonl>;
      expect(parsed.sessionId).toBe("ses_123");
      expect(parsed.summary).toBe("hello");
      expect(parsed.usage).toEqual({
        inputTokens: 150,
        cachedInputTokens: 30,
        outputTokens: 65,
      });
      expect(parsed.costUsd).toBeCloseTo(0.003, 6);
      expect(parsed.errorMessage).toBe("model access denied");
    },
  },
  {
    kind: "parser",
    name: "treats missing persisted session file as an unknown session error",
    run: (stderr) => isOpenCodeUnknownSessionError("", stderr as string),
    input:
      "NotFoundError: Resource not found: /Users/test/.local/share/opencode/storage/session/project/ses_missing.json",
    expect: true,
  },
]);

const uiScenarios: AdapterScenario[] = defineAdapterScenarios([
  {
    kind: "parser",
    name: "parses assistant and tool lifecycle events",
    run: (input) => parseOpenCodeStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "tool_use",
      part: {
        id: "prt_tool_1",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls -1" },
          output: "AGENTS.md\nDockerfile\n",
          metadata: { exit: 0 },
        },
      },
    }),
    expect: [
      { kind: "tool_call", ts: TS, name: "bash", input: { command: "ls -1" } },
      {
        kind: "tool_result",
        ts: TS,
        toolUseId: "call_1",
        content: "status: completed\nexit: 0\n\nAGENTS.md\nDockerfile",
        isError: false,
      },
    ],
  },
  {
    kind: "parser",
    name: "parses assistant text events",
    run: (input) => parseOpenCodeStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "text",
      part: { type: "text", text: "I will run a command." },
    }),
    expect: [{ kind: "assistant", ts: TS, text: "I will run a command." }],
  },
  {
    kind: "parser",
    name: "parses finished steps into usage-aware results",
    run: (input) => parseOpenCodeStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "step_finish",
      part: {
        reason: "stop",
        cost: 0.00042,
        tokens: { input: 10, output: 5, cache: { read: 2, write: 0 } },
      },
    }),
    expect: [
      {
        kind: "result",
        ts: TS,
        text: "stop",
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 2,
        costUsd: 0.00042,
        subtype: "stop",
        isError: false,
        errors: [],
      },
    ],
  },
]);

const cliScenarios: AdapterScenario[] = defineAdapterScenarios([
  {
    kind: "cli",
    name: "prints step, assistant, tool, and result events",
    run: () => {
      printOpenCodeStreamEvent(
        JSON.stringify({ type: "step_start", sessionID: "ses_abc" }),
        false,
      );
      printOpenCodeStreamEvent(
        JSON.stringify({ type: "text", part: { type: "text", text: "hello" } }),
        false,
      );
      printOpenCodeStreamEvent(
        JSON.stringify({
          type: "tool_use",
          part: {
            callID: "call_1",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "ls -1" },
              output: "AGENTS.md\n",
              metadata: { exit: 0 },
            },
          },
        }),
        false,
      );
      printOpenCodeStreamEvent(
        JSON.stringify({
          type: "step_finish",
          part: {
            reason: "stop",
            cost: 0.00042,
            tokens: { input: 10, output: 5, cache: { read: 2, write: 0 } },
          },
        }),
        false,
      );
    },
    expectLines: [
      "step started (session: ses_abc)",
      "assistant: hello",
      "tool_call: bash (call_1)",
      "tool_result status=completed exit=0",
      "AGENTS.md",
      "step finished: reason=stop",
      "tokens: in=10 out=5 cached=2 cost=$0.000420",
    ],
  },
]);

describe("opencode_local parser", () => {
  it.each(parserScenarios.filter((s) => s.name.includes("session, summary")))(
    "$name",
    runAdapterCase,
  );
});

describe("opencode_local stale session detection", () => {
  it.each(parserScenarios.filter((s) => s.name.includes("missing persisted")))(
    "$name",
    runAdapterCase,
  );
});

describe("opencode_local ui stdout parser", () => {
  it.each(uiScenarios)("$name", runAdapterCase);
});

describe("opencode_local cli formatter", () => {
  it.each(cliScenarios)("$name", runAdapterCase);
});

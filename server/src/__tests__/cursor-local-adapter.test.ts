import { describe, expect, it } from "vitest";
import {
  isCursorUnknownSessionError,
  parseCursorJsonl,
} from "@gitmesh/adapter-cursor-local/server";
import { parseCursorStdoutLine } from "@gitmesh/adapter-cursor-local/ui";
import { printCursorStreamEvent } from "@gitmesh/adapter-cursor-local/cli";
import {
  defineAdapterScenarios,
  runAdapterCase,
  type AdapterScenario,
} from "./_helpers/adapter-test-harness.js";

const TS = "2026-03-05T00:00:00.000Z";

const LONG_SHELL_CMD =
  'curl -s -X POST "$GITMESH_API_URL/api/issues/abc/checkout" -H "Authorization: Bearer $GITMESH_API_KEY"';

const serverScenarios: AdapterScenario[] = defineAdapterScenarios([
  {
    kind: "parser",
    name: "extracts session, summary, usage, cost, and terminal error message",
    run: (input) => parseCursorJsonl(input as string),
    input: [
      JSON.stringify({ type: "system", subtype: "init", session_id: "chat_123", model: "gpt-5" }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "output_text", text: "hello" }] },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "chat_123",
        usage: { input_tokens: 100, cached_input_tokens: 25, output_tokens: 40 },
        total_cost_usd: 0.001,
        result: "Task complete",
      }),
      JSON.stringify({ type: "error", message: "model access denied" }),
    ].join("\n"),
    expect: (actual: unknown) => {
      const parsed = actual as ReturnType<typeof parseCursorJsonl>;
      expect(parsed.sessionId).toBe("chat_123");
      expect(parsed.summary).toBe("hello");
      expect(parsed.usage).toEqual({
        inputTokens: 100,
        cachedInputTokens: 25,
        outputTokens: 40,
      });
      expect(parsed.costUsd).toBeCloseTo(0.001, 6);
      expect(parsed.errorMessage).toBe("model access denied");
    },
  },
  {
    kind: "parser",
    name: "parses multiplexed stdout-prefixed json lines",
    run: (input) => parseCursorJsonl(input as string),
    input: [
      'stdout{"type":"system","subtype":"init","session_id":"chat_prefixed","model":"gpt-5"}',
      'stdout{"type":"assistant","message":{"content":[{"type":"output_text","text":"prefixed hello"}]}}',
      'stdout{"type":"result","subtype":"success","usage":{"input_tokens":3,"output_tokens":2,"cached_input_tokens":1},"total_cost_usd":0.0001}',
    ].join("\n"),
    expect: (actual: unknown) => {
      const parsed = actual as ReturnType<typeof parseCursorJsonl>;
      expect(parsed.sessionId).toBe("chat_prefixed");
      expect(parsed.summary).toBe("prefixed hello");
      expect(parsed.usage).toEqual({
        inputTokens: 3,
        cachedInputTokens: 1,
        outputTokens: 2,
      });
      expect(parsed.costUsd).toBeCloseTo(0.0001, 6);
    },
  },
]);

const staleScenarios: AdapterScenario[] = defineAdapterScenarios([
  {
    kind: "parser",
    name: 'detects "unknown session id" error',
    run: (stderr) => isCursorUnknownSessionError("", stderr as string),
    input: "unknown session id chat_123",
    expect: true,
  },
  {
    kind: "parser",
    name: 'detects "chat ... not found" error',
    run: (stderr) => isCursorUnknownSessionError("", stderr as string),
    input: "chat abc not found",
    expect: true,
  },
]);

const uiScenarios: AdapterScenario[] = defineAdapterScenarios([
  {
    kind: "parser",
    name: "parses assistant, thinking, and tool lifecycle events",
    run: (input) => parseCursorStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "output_text", text: "I will run a command." },
          { type: "thinking", text: "Checking repository state" },
          { type: "tool_call", name: "bash", input: { command: "ls -1" } },
          { type: "tool_result", tool_use_id: "tool_1", output: "AGENTS.md\n", status: "ok" },
        ],
      },
    }),
    expect: [
      { kind: "assistant", ts: TS, text: "I will run a command." },
      { kind: "thinking", ts: TS, text: "Checking repository state" },
      { kind: "tool_call", ts: TS, name: "bash", input: { command: "ls -1" } },
      {
        kind: "tool_result",
        ts: TS,
        toolUseId: "tool_1",
        content: "AGENTS.md\n",
        isError: false,
      },
    ],
  },
  {
    kind: "parser",
    name: "parses result usage and errors",
    run: (input) => parseCursorStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "result",
      subtype: "success",
      result: "Done",
      usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 2 },
      total_cost_usd: 0.00042,
      is_error: false,
    }),
    expect: [
      {
        kind: "result",
        ts: TS,
        text: "Done",
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 2,
        costUsd: 0.00042,
        subtype: "success",
        isError: false,
        errors: [],
      },
    ],
  },
  {
    kind: "parser",
    name: "parses stdout-prefixed json lines",
    run: (input) => parseCursorStdoutLine(input as string, TS),
    input:
      'stdout{"type":"assistant","message":{"content":[{"type":"thinking","text":"streamed"}]}}',
    expect: [{ kind: "thinking", ts: TS, text: "streamed" }],
  },
  {
    kind: "parser",
    name: "compacts shellToolCall start into tool_call",
    run: (input) => parseCursorStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "tool_call",
      subtype: "started",
      call_id: "call_shell_1",
      tool_call: {
        shellToolCall: {
          command: LONG_SHELL_CMD,
          workingDirectory: "/tmp",
          timeout: 30000,
          toolCallId: "tool_xyz",
          simpleCommands: ["curl"],
          parsingResult: { parsingFailed: false, executableCommands: [] },
        },
      },
    }),
    expect: [
      {
        kind: "tool_call",
        ts: TS,
        name: "shellToolCall",
        input: { command: LONG_SHELL_CMD },
      },
    ],
  },
  {
    kind: "parser",
    name: "compacts shellToolCall completion into tool_result",
    run: (input) => parseCursorStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "tool_call",
      subtype: "completed",
      call_id: "call_shell_1",
      tool_call: {
        shellToolCall: {
          result: {
            success: {
              command: LONG_SHELL_CMD,
              exitCode: 0,
              stdout: '{"id":"abc","status":"in_progress"}',
              stderr: "",
              executionTime: 100,
            },
          },
        },
      },
    }),
    expect: [
      {
        kind: "tool_result",
        ts: TS,
        toolUseId: "call_shell_1",
        content: 'exit 0\n<stdout>\n{"id":"abc","status":"in_progress"}',
        isError: false,
      },
    ],
  },
  {
    kind: "parser",
    name: "parses top-level user message",
    run: (input) => parseCursorStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "Please inspect README.md" }],
      },
    }),
    expect: [{ kind: "user", ts: TS, text: "Please inspect README.md" }],
  },
  {
    kind: "parser",
    name: "parses top-level thinking delta",
    run: (input) => parseCursorStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "thinking",
      subtype: "delta",
      text: "planning next command",
    }),
    expect: [{ kind: "thinking", ts: TS, text: "planning next command", delta: true }],
  },
  {
    kind: "parser",
    name: "preserves leading space in thinking delta",
    run: (input) => parseCursorStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "thinking",
      subtype: "delta",
      text: " with preserved leading space",
    }),
    expect: [
      { kind: "thinking", ts: TS, text: " with preserved leading space", delta: true },
    ],
  },
  {
    kind: "parser",
    name: "parses readToolCall start as tool_call",
    run: (input) => parseCursorStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "tool_call",
      subtype: "started",
      call_id: "call_1",
      tool_call: { readToolCall: { args: { path: "README.md" } } },
    }),
    expect: [
      { kind: "tool_call", ts: TS, name: "readToolCall", input: { path: "README.md" } },
    ],
  },
  {
    kind: "parser",
    name: "parses readToolCall completion as tool_result",
    run: (input) => parseCursorStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "tool_call",
      subtype: "completed",
      call_id: "call_1",
      tool_call: {
        readToolCall: { result: { success: { content: "README contents" } } },
      },
    }),
    expect: [
      {
        kind: "tool_result",
        ts: TS,
        toolUseId: "call_1",
        content: '{\n  "success": {\n    "content": "README contents"\n  }\n}',
        isError: false,
      },
    ],
  },
]);

const cliScenarios: AdapterScenario[] = defineAdapterScenarios([
  {
    kind: "cli",
    name: "prints init, user, assistant, tool, and result events",
    run: () => {
      printCursorStreamEvent(
        JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "chat_abc",
          model: "gpt-5",
        }),
        false,
      );
      printCursorStreamEvent(
        JSON.stringify({
          type: "user",
          message: { content: [{ type: "text", text: "run tests" }] },
        }),
        false,
      );
      printCursorStreamEvent(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "output_text", text: "hello" }] },
        }),
        false,
      );
      printCursorStreamEvent(
        JSON.stringify({
          type: "thinking",
          subtype: "delta",
          text: "looking at package.json",
        }),
        false,
      );
      printCursorStreamEvent(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "tool_call", name: "bash", input: { command: "ls -1" } }],
          },
        }),
        false,
      );
      printCursorStreamEvent(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "tool_result", output: "AGENTS.md", status: "ok" }],
          },
        }),
        false,
      );
      printCursorStreamEvent(
        JSON.stringify({
          type: "tool_call",
          subtype: "started",
          call_id: "call_1",
          tool_call: { readToolCall: { args: { path: "README.md" } } },
        }),
        false,
      );
      printCursorStreamEvent(
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "call_1",
          tool_call: {
            readToolCall: { result: { success: { content: "README contents" } } },
          },
        }),
        false,
      );
      printCursorStreamEvent(
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "Done",
          usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 2 },
          total_cost_usd: 0.00042,
        }),
        false,
      );
    },
    expectLines: [
      "Cursor init (session: chat_abc, model: gpt-5)",
      "user: run tests",
      "assistant: hello",
      "thinking: looking at package.json",
      "tool_call: bash",
      "tool_call: readToolCall (call_1)",
      "tool_result (call_1)",
      '{\n  "success": {\n    "content": "README contents"\n  }\n}',
      "tool_result",
      "AGENTS.md",
      "result: subtype=success",
      "tokens: in=10 out=5 cached=2 cost=$0.000420",
      "assistant: Done",
    ],
  },
]);

describe("cursor parser", () => {
  it.each(serverScenarios)("$name", runAdapterCase);
});

describe("cursor stale session detection", () => {
  it.each(staleScenarios)("$name", runAdapterCase);
});

describe("cursor ui stdout parser", () => {
  it.each(uiScenarios)("$name", runAdapterCase);
});

describe("cursor cli formatter", () => {
  it.each(cliScenarios)("$name", runAdapterCase);
});

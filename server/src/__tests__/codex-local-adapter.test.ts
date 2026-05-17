import { describe, expect, it } from "vitest";
import {
  isCodexUnknownSessionError,
  parseCodexJsonl,
} from "@gitmesh/adapter-codex-local/server";
import { parseCodexStdoutLine } from "@gitmesh/adapter-codex-local/ui";
import { printCodexStreamEvent } from "@gitmesh/adapter-codex-local/cli";
import {
  defineAdapterScenarios,
  runAdapterCase,
  type AdapterScenario,
} from "./_helpers/adapter-test-harness.js";

const TS = "2026-02-20T00:00:00.000Z";

const serverScenarios: AdapterScenario[] = defineAdapterScenarios([
  {
    kind: "parser",
    name: "extracts session, summary, usage, and terminal error message",
    run: (input) => parseCodexJsonl(input as string),
    input: [
      JSON.stringify({ type: "thread.started", thread_id: "thread-123" }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "hello" },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 4 },
      }),
      JSON.stringify({
        type: "turn.failed",
        error: { message: "model access denied" },
      }),
    ].join("\n"),
    expect: (actual: unknown) => {
      const parsed = actual as ReturnType<typeof parseCodexJsonl>;
      expect(parsed.sessionId).toBe("thread-123");
      expect(parsed.summary).toBe("hello");
      expect(parsed.usage).toEqual({
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 4,
      });
      expect(parsed.errorMessage).toBe("model access denied");
    },
  },
  {
    kind: "parser",
    name: "treats missing rollout path as an unknown session error",
    run: (stderr) => isCodexUnknownSessionError("", stderr as string),
    input:
      "2026-02-19T19:58:53.281939Z ERROR codex_core::rollout::list: state db missing rollout path for thread 019c775d-967c-7ef1-acc7-e396dc2c87cc",
    expect: true,
  },
]);

const uiScenarios: AdapterScenario[] = defineAdapterScenarios([
  {
    kind: "parser",
    name: "parses turn.started lifecycle event",
    run: (input) => parseCodexStdoutLine(input as string, TS),
    input: JSON.stringify({ type: "turn.started" }),
    expect: [{ kind: "system", ts: TS, text: "turn started" }],
  },
  {
    kind: "parser",
    name: "parses reasoning lifecycle item",
    run: (input) => parseCodexStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_1",
        type: "reasoning",
        text: "**Preparing to use gitmesh-agents skill**",
      },
    }),
    expect: [
      { kind: "thinking", ts: TS, text: "**Preparing to use gitmesh-agents skill**" },
    ],
  },
  {
    kind: "parser",
    name: "parses command_execution start as a tool_call",
    run: (input) => parseCodexStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "item.started",
      item: {
        id: "item_2",
        type: "command_execution",
        command: "/bin/zsh -lc ls",
        status: "in_progress",
      },
    }),
    expect: [
      {
        kind: "tool_call",
        ts: TS,
        name: "command_execution",
        input: { id: "item_2", command: "/bin/zsh -lc ls" },
      },
    ],
  },
  {
    kind: "parser",
    name: "parses command_execution completion as a tool_result",
    run: (input) => parseCodexStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_2",
        type: "command_execution",
        command: "/bin/zsh -lc ls",
        aggregated_output: "agents\n",
        exit_code: 0,
        status: "completed",
      },
    }),
    expect: [
      {
        kind: "tool_result",
        ts: TS,
        toolUseId: "item_2",
        content: "command: /bin/zsh -lc ls\nstatus: completed\nexit_code: 0\n\nagents",
        isError: false,
      },
    ],
  },
  {
    kind: "parser",
    name: "parses file_change items into a system event",
    run: (input) => parseCodexStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_52",
        type: "file_change",
        changes: [
          { path: "/home/user/project/ui/src/pages/AgentDetail.tsx", kind: "update" },
        ],
        status: "completed",
      },
    }),
    expect: [
      {
        kind: "system",
        ts: TS,
        text: "file changes: update /home/user/project/ui/src/pages/AgentDetail.tsx",
      },
    ],
  },
  {
    kind: "parser",
    name: "parses error item as stderr event",
    run: (input) => parseCodexStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_0",
        type: "error",
        message:
          "This session was recorded with model `gpt-5.2-pro` but is resuming with `gpt-5.2-codex`.",
      },
    }),
    expect: [
      {
        kind: "stderr",
        ts: TS,
        text: "This session was recorded with model `gpt-5.2-pro` but is resuming with `gpt-5.2-codex`.",
      },
    ],
  },
  {
    kind: "parser",
    name: "parses turn.failed as an error result",
    run: (input) => parseCodexStdoutLine(input as string, TS),
    input: JSON.stringify({
      type: "turn.failed",
      error: { message: "model access denied" },
      usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 4 },
    }),
    expect: [
      {
        kind: "result",
        ts: TS,
        text: "",
        inputTokens: 10,
        outputTokens: 4,
        cachedTokens: 2,
        costUsd: 0,
        subtype: "turn.failed",
        isError: true,
        errors: ["model access denied"],
      },
    ],
  },
]);

const cliScenarios: AdapterScenario[] = defineAdapterScenarios([
  {
    kind: "cli",
    name: "prints lifecycle, command execution, file change, and error events",
    run: () => {
      printCodexStreamEvent(JSON.stringify({ type: "turn.started" }), false);
      printCodexStreamEvent(
        JSON.stringify({
          type: "item.started",
          item: {
            id: "item_2",
            type: "command_execution",
            command: "/bin/zsh -lc ls",
            status: "in_progress",
          },
        }),
        false,
      );
      printCodexStreamEvent(
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_2",
            type: "command_execution",
            command: "/bin/zsh -lc ls",
            aggregated_output: "agents\n",
            exit_code: 0,
            status: "completed",
          },
        }),
        false,
      );
      printCodexStreamEvent(
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_52",
            type: "file_change",
            changes: [
              { path: "/home/user/project/ui/src/pages/AgentDetail.tsx", kind: "update" },
            ],
            status: "completed",
          },
        }),
        false,
      );
      printCodexStreamEvent(
        JSON.stringify({
          type: "turn.failed",
          error: { message: "model access denied" },
          usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 4 },
        }),
        false,
      );
      printCodexStreamEvent(
        JSON.stringify({
          type: "item.completed",
          item: { type: "error", message: "resume model mismatch" },
        }),
        false,
      );
    },
    expectLines: [
      "turn started",
      "tool_call: command_execution",
      "/bin/zsh -lc ls",
      'tool_result: command_execution command="/bin/zsh -lc ls" status=completed exit_code=0',
      "agents",
      "file_change: update /home/user/project/ui/src/pages/AgentDetail.tsx",
      "turn failed: model access denied",
      "tokens: in=10 out=4 cached=2",
      "error: resume model mismatch",
    ],
  },
]);

describe("codex_local parser", () => {
  it.each(serverScenarios.filter((s) => s.name.includes("session, summary")))(
    "$name",
    runAdapterCase,
  );
});

describe("codex_local stale session detection", () => {
  it.each(serverScenarios.filter((s) => s.name.includes("rollout path")))(
    "$name",
    runAdapterCase,
  );
});

describe("codex_local ui stdout parser", () => {
  it.each(uiScenarios)("$name", runAdapterCase);
});

describe("codex_local cli formatter", () => {
  it.each(cliScenarios)("$name", runAdapterCase);
});

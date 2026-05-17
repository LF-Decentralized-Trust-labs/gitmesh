/**
 * Declarative test harness for adapter suites. Tests are expressed as a list
 * of scenarios consumed by `it.each`. Three scenario shapes:
 *
 *   1. `parser`    — pure stdin/stdout transforms (parse JSONL etc.).
 *   2. `cli`       — capture `console.log` while invoking a printer.
 *   3. `assertion` — escape hatch for one-off checks.
 *
 * `execute` and `testEnvironment` flows have their own scenario builders
 * below; they need more I/O setup than a single generic shape allows.
 */
import { expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Generic parser/CLI scenarios
// ---------------------------------------------------------------------------

export type ParserScenario<TInput, TOutput> = {
  kind: "parser";
  name: string;
  /** Parser/decoder under test. */
  run: (input: TInput) => TOutput;
  input: TInput;
  /** Either a strict equality target or a callback for richer assertions. */
  expect: TOutput | ((actual: TOutput) => void);
};

export type CliScenario = {
  kind: "cli";
  name: string;
  /** Calls into the CLI printer; the harness silences `console.log`. */
  run: () => void;
  /** Substrings/exact lines that must appear in printed output (ANSI-stripped). */
  expectLines: string[];
};

export type AssertionScenario = {
  kind: "assertion";
  name: string;
  run: () => void | Promise<void>;
};

export type AdapterScenario =
  | ParserScenario<unknown, unknown>
  | CliScenario
  | AssertionScenario;

/** Strip ANSI color codes so assertions stay portable across terminals. */
export function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Drive a single scenario through the appropriate verifier. Plug into
 * `it.each(scenarios)('$name', runAdapterCase)`.
 */
export async function runAdapterCase(scenario: AdapterScenario): Promise<void> {
  if (scenario.kind === "parser") {
    const actual = scenario.run(scenario.input);
    if (typeof scenario.expect === "function") {
      (scenario.expect as (a: unknown) => void)(actual);
    } else {
      expect(actual).toEqual(scenario.expect);
    }
    return;
  }

  if (scenario.kind === "cli") {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      scenario.run();
      const lines = spy.mock.calls
        .map((call) => call.map((v) => String(v)).join(" "))
        .map(stripAnsi);
      expect(lines).toEqual(expect.arrayContaining(scenario.expectLines));
    } finally {
      spy.mockRestore();
    }
    return;
  }

  await scenario.run();
}

/**
 * Identity helper that is solely useful for the strong-typing it provides.
 * Call sites read better as `defineAdapterScenarios([...])` than a literal
 * array annotated with the union type.
 */
export function defineAdapterScenarios(
  scenarios: AdapterScenario[],
): AdapterScenario[] {
  return scenarios;
}

// ---------------------------------------------------------------------------
// Adapter `testEnvironment` scenarios
// ---------------------------------------------------------------------------

export type EnvCheck = { code?: string; level?: string; hint?: string | null };
export type EnvResult = { status: string; checks: EnvCheck[] };
export type EnvironmentRunner = (config: unknown) => Promise<EnvResult>;

export type EnvironmentExpectation = (result: EnvResult) => void | Promise<void>;

export interface ArrangedEnvironment<TCtx = unknown> {
  config: unknown;
  /** Free-form context the post-assertion phase may want (paths, etc). */
  ctx?: TCtx;
  cleanup?: () => Promise<void>;
}

export type EnvironmentScenario<TCtx = unknown> = {
  name: string;
  /** Builds the config object passed to `testEnvironment`. May allocate dirs. */
  arrange: () => Promise<ArrangedEnvironment<TCtx>>;
  /** Primary assertion against the testEnvironment result. */
  expect: EnvironmentExpectation;
  /** Post-flight assertion (e.g. verifying side effects on disk). */
  postAssert?: (ctx: TCtx, result: EnvResult) => void | Promise<void>;
};

/** Drive a single environment scenario. */
export async function runEnvironmentCase<TCtx>(
  runner: EnvironmentRunner,
  scenario: EnvironmentScenario<TCtx>,
): Promise<void> {
  const arranged = await scenario.arrange();
  try {
    const result = await runner(arranged.config);
    await scenario.expect(result);
    if (scenario.postAssert) {
      await scenario.postAssert(arranged.ctx as TCtx, result);
    }
  } finally {
    if (arranged.cleanup) {
      await arranged.cleanup();
    }
  }
}

/**
 * Build a generic `assertAdapterEnvironment(adapterRunner, expectedCode)`
 * helper used by the small `*-adapter-environment.test.ts` files. The
 * "expected env" object describes which check codes/levels/statuses must
 * appear without forcing each caller to spell out the same `expect.some`
 * pattern over and over.
 */
export interface ExpectedEnvShape {
  /** Overall status string, e.g. "fail" or "warn". */
  status?: string;
  /** Codes that must appear among `result.checks`. */
  codes?: string[];
  /** Codes that must NOT appear with `level === "error"` (allowlist style). */
  forbidErrorLevel?: boolean;
  /** Code → level pairs that must appear together. */
  codeLevel?: Array<{ code: string; level: string }>;
  /** Code whose `hint` must contain the given substring. */
  hintContains?: { code: string; substring: string };
}

export function assertAdapterEnvironment(
  result: EnvResult,
  expected: ExpectedEnvShape,
): void {
  if (expected.status !== undefined) {
    expect(result.status).toBe(expected.status);
  }
  for (const code of expected.codes ?? []) {
    expect(
      result.checks.some((check) => check.code === code),
      `expected check code "${code}" to be present`,
    ).toBe(true);
  }
  for (const { code, level } of expected.codeLevel ?? []) {
    expect(
      result.checks.some(
        (check) => check.code === code && check.level === level,
      ),
      `expected check code "${code}" with level "${level}"`,
    ).toBe(true);
  }
  if (expected.forbidErrorLevel) {
    expect(result.checks.some((check) => check.level === "error")).toBe(false);
  }
  if (expected.hintContains) {
    const found = result.checks.find(
      (check) => check.code === expected.hintContains!.code,
    );
    expect(found, `expected check "${expected.hintContains.code}"`).toBeTruthy();
    expect(found?.hint ?? "").toContain(expected.hintContains.substring);
  }
}

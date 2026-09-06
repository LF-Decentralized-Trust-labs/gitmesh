import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as childProcess from "node:child_process";
import * as dns from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { assertGoldenCase } from "@gitmesh/workspace-adapters";
import { renderDoctorJson, type DoctorJson } from "@gitmesh/workspace-core";
import { createProgram } from "../program.js";
import { collectDoctorReport, findRepoRoot, runDoctor } from "../workspace/doctor.js";

/**
 * T1.17 spies: a curated set of mutating fs APIs, network entry points and
 * subprocess spawners is wrapped in a recording mock (originals still run,
 * so test setup works); a doctor run must leave all of them uncalled.
 * Ambiguous calls such as `fs.open` (read or write depending on flags) are
 * not tracked.
 */
const { SPIED, wrap } = vi.hoisted(() => {
  const SPIED: Record<string, readonly string[]> = {
    "node:fs": [
      "appendFile", "appendFileSync", "chmod", "chmodSync", "chown", "chownSync", "copyFile",
      "copyFileSync", "cp", "cpSync", "createWriteStream", "link", "linkSync", "mkdir",
      "mkdirSync", "mkdtemp", "mkdtempSync", "rename", "renameSync", "rm", "rmSync", "rmdir",
      "rmdirSync", "symlink", "symlinkSync", "truncate", "truncateSync", "unlink", "unlinkSync",
      "utimes", "utimesSync", "write", "writeFile", "writeFileSync", "writeSync", "writev",
      "writevSync",
    ],
    "node:fs/promises": [
      "appendFile", "chmod", "chown", "copyFile", "cp", "link", "mkdir", "mkdtemp", "rename",
      "rm", "rmdir", "symlink", "truncate", "unlink", "utimes", "writeFile",
    ],
    "node:http": ["request", "get"],
    "node:https": ["request", "get"],
    "node:net": ["connect", "createConnection"],
    "node:dns": ["lookup", "resolve", "resolve4", "resolve6"],
    "node:child_process": ["exec", "execFile", "execFileSync", "execSync", "fork", "spawn", "spawnSync"],
  };
  /** The original module with the listed functions wrapped, on the namespace and its default. */
  const wrap = (id: string, actual: Record<string, unknown>) => {
    const spies: Record<string, unknown> = {};
    for (const name of SPIED[id] ?? []) {
      spies[name] = vi.fn(actual[name] as (...args: unknown[]) => unknown);
    }
    const base = actual["default"] as Record<string, unknown> | undefined;
    return { ...actual, ...spies, default: { ...base, ...spies } };
  };
  return { SPIED, wrap };
});
type Original = () => Promise<Record<string, unknown>>;
vi.mock("node:fs", async (original: Original) => wrap("node:fs", await original()));
vi.mock("node:fs/promises", async (original: Original) => wrap("node:fs/promises", await original()));
vi.mock("node:http", async (original: Original) => wrap("node:http", await original()));
vi.mock("node:https", async (original: Original) => wrap("node:https", await original()));
vi.mock("node:net", async (original: Original) => wrap("node:net", await original()));
vi.mock("node:dns", async (original: Original) => wrap("node:dns", await original()));
vi.mock("node:child_process", async (original: Original) =>
  wrap("node:child_process", await original()),
);
const MODULES: Record<string, Record<string, unknown>> = {
  "node:fs": fs,
  "node:fs/promises": fsPromises,
  "node:http": http,
  "node:https": https,
  "node:net": net,
  "node:dns": dns,
  "node:child_process": childProcess,
};

/** `module.fn` names whose spy recorded at least one call. */
function calledSpies(): string[] {
  return Object.entries(SPIED).flatMap(([id, names]) =>
    names
      .filter((name) => (MODULES[id]![name] as Mock).mock.calls.length > 0)
      .map((name) => `${id}.${name}`),
  );
}

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/doctor/sample");
const SECRET = "ghp_FAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKE01";

const tempDirs: string[] = [];
function makeRepo(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "gitmesh-doctor-"));
  tempDirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
function sampleCopy(): string {
  const root = makeRepo();
  cpSync(join(FIXTURE, "input-repo"), root, { recursive: true });
  return root;
}
const symlinksSupported = (() => {
  const root = makeRepo({ "target.txt": "x" });
  try {
    symlinkSync("target.txt", join(root, "link"));
    return true;
  } catch {
    return false;
  }
})();

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

/** A repo with only a cursor rule: GM002 (warning) fires, nothing else. */
const WARNING_ONLY = { ".cursor/rules/a.mdc": "Prefer named exports.\n" };

describe("gitmesh doctor - pipeline", () => {
  it("matches the sample golden --json byte-exactly", async () => {
    await assertGoldenCase(
      { inputRepoDir: join(FIXTURE, "input-repo"), expectedDir: join(FIXTURE, "expected") },
      async (root) => [
        { path: "doctor.json", content: renderDoctorJson(await collectDoctorReport({ rootDir: root })) },
      ],
    );
  });

  it("never emits a secret value in any output mode", async () => {
    const dir = sampleCopy();
    for (const mode of [{}, { json: true }, { md: true }]) {
      const { output } = await runDoctor({ dir, ...mode });
      expect(output).toContain("GM001");
      expect(output).not.toContain(SECRET);
    }
  });

  it("feeds only root-anchored instruction documents to the drift differ", async () => {
    const dir = makeRepo({
      "AGENTS.md": "# Rules\n\nUse pnpm.\n",
      "CLAUDE.md": "@AGENTS.md\n",
      "packages/app/AGENTS.md": "# App rules\n",
      "CLAUDE.local.md": "# Mine\n",
    });
    const { report } = await runDoctor({ dir });
    expect(report.artifacts.map((a) => a.path)).toContain("packages/app/AGENTS.md");
    expect(report.artifacts.map((a) => a.path)).toContain("CLAUDE.local.md");
    expect(report.drift.documents.map((d) => d.label)).toEqual(["AGENTS.md", "CLAUDE.md"]);
  });

  it.skipIf(!symlinksSupported)("reports a symlinked CLAUDE.md as a zero-drift group", async () => {
    const dir = makeRepo({ "AGENTS.md": "# Rules\n\nUse pnpm.\n" });
    symlinkSync("AGENTS.md", join(dir, "CLAUDE.md"));
    const { report } = await runDoctor({ dir });
    expect(report.drift.symlinkGroups).toEqual([["AGENTS.md", "CLAUDE.md"]]);
    expect(report.drift.pairs).toEqual([]);
    expect(report.findings.map((f) => f.ruleId)).not.toContain("GM010");
    expect(report.artifacts.find((a) => a.path === "CLAUDE.md")?.symlinkTarget).toBe("AGENTS.md");
  });

  it("reads user-scope artifacts only when asked", async () => {
    const home = makeRepo({ ".claude/CLAUDE.md": "# Personal\n" });
    const rootDir = makeRepo();
    const on = await collectDoctorReport({ rootDir, userScope: true, homeDir: home });
    expect(on.artifacts).toContainEqual(
      expect.objectContaining({ path: "~/.claude/CLAUDE.md", scope: "user", content: "# Personal\n" }),
    );
    expect(on.drift.documents).toEqual([]);
    const off = await collectDoctorReport({ rootDir, homeDir: home });
    expect(off.artifacts).toEqual([]);
  });

  it("scans the enclosing git root of the given directory", async () => {
    const root = makeRepo({ ".git/HEAD": "ref: refs/heads/main\n", "AGENTS.md": "# Rules\n" });
    const nested = join(root, "packages", "app");
    mkdirSync(nested, { recursive: true });
    expect(findRepoRoot(nested)).toBe(root);
    expect(findRepoRoot(makeRepo())).toMatch(/gitmesh-doctor-/);
    const { report } = await runDoctor({ dir: nested });
    expect(report.artifacts.map((a) => a.path)).toContain("AGENTS.md");
  });
});

describe("gitmesh doctor - exit codes and --fail-on", () => {
  it("exits 0 on a clean repository", async () => {
    const { exitCode, output } = await runDoctor({ dir: makeRepo(), json: true });
    expect(exitCode).toBe(0);
    expect((JSON.parse(output) as DoctorJson).summary.score).toBe(100);
  });

  it.each([
    ["warning", 1],
    ["error", 0],
    ["info", 1],
    ["none", 0],
  ])("with only warnings, --fail-on %s exits %i", async (failOn, expected) => {
    const { exitCode, report } = await runDoctor({ dir: makeRepo(WARNING_ONLY), failOn });
    expect(report.findings.map((f) => f.severity)).toEqual(["warning"]);
    expect(exitCode).toBe(expected);
  });

  it("defaults to --fail-on warning and fails on errors at every level but none", async () => {
    const dir = sampleCopy();
    expect((await runDoctor({ dir })).exitCode).toBe(1);
    expect((await runDoctor({ dir, failOn: "error" })).exitCode).toBe(1);
    expect((await runDoctor({ dir, failOn: "none" })).exitCode).toBe(0);
  });

  it("rejects bad usage so the command exits 2", async () => {
    const dir = makeRepo();
    await expect(runDoctor({ dir, failOn: "bogus" })).rejects.toThrow("--fail-on must be one of");
    await expect(runDoctor({ dir, json: true, md: true })).rejects.toThrow("mutually exclusive");
    await expect(runDoctor({ dir: join(dir, "missing") })).rejects.toThrow("is not a directory");
  });
});

describe("gitmesh doctor - read-only guarantees (spies)", () => {
  it("the spies are live", () => {
    const dir = makeRepo();
    vi.clearAllMocks();
    writeFileSync(join(dir, "probe.txt"), "x");
    expect(calledSpies()).toEqual(["node:fs.writeFileSync"]);
    for (const [id, names] of Object.entries(SPIED)) {
      for (const name of names) expect(vi.isMockFunction(MODULES[id]![name]), `${id}.${name}`).toBe(true);
    }
  });

  it("never writes a file, opens a connection, or spawns a process", async () => {
    const dirs = [sampleCopy(), makeRepo(WARNING_ONLY), makeRepo()];
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.clearAllMocks();
    for (const dir of dirs) {
      for (const mode of [{ color: true }, { json: true }, { md: true }]) {
        await runDoctor({ dir, ...mode });
      }
    }
    expect(calledSpies()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("gitmesh doctor - command wiring", () => {
  function harness() {
    let err = "";
    const program = createProgram("gitmesh", (p) => {
      p.exitOverride();
      p.configureOutput({ writeOut: () => {}, writeErr: (s) => (err += s) });
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    return { program, err: () => err, out: () => stdout.mock.calls.map((c) => String(c[0])).join("") };
  }

  it("prints the report to stdout and sets the exit code", async () => {
    const { program, out } = harness();
    await program.parseAsync(["doctor", sampleCopy(), "--json"], { from: "user" });
    const json = JSON.parse(out()) as DoctorJson;
    expect(json.schemaVersion).toBe(1);
    expect(json.findings.map((f) => f.ruleId)).toEqual(["GM001", "GM002"]);
    expect(process.exitCode).toBe(1);
  });

  it("honors --fail-on and --md", async () => {
    const { program, out } = harness();
    await program.parseAsync(["doctor", makeRepo(WARNING_ONLY), "--md", "--fail-on", "error"], {
      from: "user",
    });
    expect(out()).toMatch(/^## gitmesh doctor: 95\/100\n/);
    expect(process.exitCode).toBe(0);
  });

  it("exits 2 with a gitmesh doctor: message on a run error", async () => {
    const { program, err, out } = harness();
    await expect(
      program.parseAsync(["doctor", join(makeRepo(), "missing")], { from: "user" }),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(err()).toContain("gitmesh doctor: ");
    expect(err()).toContain("is not a directory");
    expect(out()).toBe("");
  });
});

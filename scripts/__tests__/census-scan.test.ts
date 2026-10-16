import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OUTSIDE_TARGET, scanRepository } from "../census/scan.js";

/**
 * Census scan (pivot T2.4) against a local fixture repository fetched over
 * file://, so no network: doctor audits exactly the pinned commit, never
 * reads through a symlink that leaves the checkout, ignores this machine's
 * agent config, and leaves nothing behind.
 */

/** Text that must never reach a result: it sits outside the checkout. */
const CANARY = "census-canary-outside-the-checkout";

let base: string;
let origin: string;
let work: string;
let commit: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=census", "-c", "user.email=census@example.invalid", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

const entry = (pinned = commit) => ({ repo: "acme/fixture", commit: pinned, stars: 1, license: "MIT" });
const remote = () => pathToFileURL(origin).href;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "census-scan-test-"));
  origin = join(base, "origin");
  // Checkouts are created inside `work`, so `../outside.md` from a checkout's root lands on the canary.
  work = join(base, "work");
  mkdirSync(origin);
  mkdirSync(work);
  writeFileSync(join(work, "outside.md"), `# Outside\n\n${CANARY}\n`);
  writeFileSync(join(origin, "AGENTS.md"), "# Rules\n\nUse pnpm.\n");
  writeFileSync(join(origin, "CLAUDE.md"), "# Rules\n\nUse npm.\n");
  symlinkSync("AGENTS.md", join(origin, "GEMINI.md"));
  symlinkSync(join(work, "outside.md"), join(origin, ".cursorrules"));
  symlinkSync("../outside.md", join(origin, ".clinerules"));
  git(origin, "init", "--quiet");
  git(origin, "add", "--all");
  git(origin, "commit", "--quiet", "--message", "fixture");
  commit = git(origin, "rev-parse", "HEAD");
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("census scan", () => {
  it("audits the pinned commit and reports doctor's --json view of it", async () => {
    const result = await scanRepository(entry(), work, remote);
    expect(result).toMatchObject({ repo: "acme/fixture", commit, status: "ok" });
    expect(result.doctor?.schemaVersion).toBe(1);
    expect(result.doctor?.drift.symlinkGroups).toEqual([["AGENTS.md", "GEMINI.md"]]);
    expect(result.doctor?.drift.pairs).toEqual([expect.objectContaining({ a: "AGENTS.md", b: "CLAUDE.md", identical: false })]);
  });

  it("re-points symlinks that leave the checkout, so doctor reports them broken and never reads through them", async () => {
    const result = await scanRepository(entry(), work, remote);
    expect(result.outsideSymlinks).toEqual([".clinerules -> ../outside.md", `.cursorrules -> ${join(work, "outside.md")}`]);
    expect(JSON.stringify(result)).not.toContain(CANARY);
    const escaped = result.doctor?.artifacts.filter((a) => a.path === ".cursorrules" || a.path === ".clinerules");
    expect(escaped?.length).toBeGreaterThan(0);
    for (const artifact of escaped ?? []) {
      expect(artifact).toMatchObject({ symlinkTarget: OUTSIDE_TARGET, broken: true });
    }
  });

  it("ignores this machine's agent configuration", async () => {
    const codexHome = join(base, "codex-home");
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, "config.toml"), 'approval_policy = "never"\n');
    process.env.CODEX_HOME = codexHome;
    try {
      const result = await scanRepository(entry(), work, remote);
      expect(result.doctor?.artifacts.filter((a) => a.scope !== "project")).toEqual([]);
    } finally {
      delete process.env.CODEX_HOME;
    }
  });

  it("produces the same result every time and leaves no checkout behind", async () => {
    const first = await scanRepository(entry(), work, remote);
    expect(await scanRepository(entry(), work, remote)).toEqual(first);
    expect(readdirSync(work)).toEqual(["outside.md"]);
  });

  it("marks a commit it cannot fetch unavailable", async () => {
    const result = await scanRepository(entry("b".repeat(40)), work, remote);
    expect(result).toMatchObject({ status: "unavailable", outsideSymlinks: [] });
    expect(result.error).toBeTruthy();
    expect(result.doctor).toBeUndefined();
    expect(readdirSync(work)).toEqual(["outside.md"]);
  });
});

/**
 * T1.18 performance guard: `gitmesh doctor` on a 5k-file repo in under 2s
 * (pivot §12 E1). Doctor's cost scales with tree size - most detectors run
 * their own full-tree walk - and nothing else would catch a regression that
 * makes the wedge command sluggish on a real repository.
 *
 * The 5,000-file fixture is generated into a temp directory, not checked in:
 * committing 5k files would dwarf every fixture in the repo combined and slow
 * each checkout, while a deterministic generator (fixed file list, fixed
 * content, no timestamps) guards the same thing. The suite is gated behind
 * GITMESH_DOCTOR_PERF=1 and runs as its own CI step (`pnpm test:perf`): the
 * regular `pnpm test:run` executes many projects in parallel workers on a
 * shared 2-vCPU runner, where a wall-clock assertion would measure scheduler
 * contention, not doctor. Run locally with `pnpm test:perf`.
 *
 * Kept separate from doctor.test.ts: that file wraps node:fs in recording
 * mocks at module level, and this one must measure the real filesystem.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RepoContext } from "@gitmesh/workspace-adapters";

/**
 * Machine-scoped probes pinned off, mirroring HERMETIC in doctor.test.ts
 * (not imported from there - see above). Without this, a contributor with
 * CODEX_HOME exported or org-managed settings installed would scan extra
 * artifacts and time a different run.
 */
const HERMETIC: Partial<RepoContext> = {
  env: {},
  managedSettingsPaths: [],
  requirementsTomlPaths: [],
  antigravitySettingsPaths: [],
};

const BUDGET_MS = 2000;
const TIMED_RUNS = 3;

/**
 * A deterministic ~5k-file repository: 500 modules of 10 source files, with
 * agent artifacts spread through the tree so every pipeline stage does real
 * work - a divergent AGENTS.md/CLAUDE.md root pair (drift differ + GM010),
 * nested AGENTS.md files at depth, stray `.mdc` files (the cursor detector
 * content-reads every one), settings/MCP/skill/instruction files - plus a
 * node_modules decoy subtree that the walks must skip entirely.
 */
function buildFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "gitmesh-doctor-perf-"));
  const put = (rel: string, content: string): void => {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  };
  // findRepoRoot climbs to the nearest .git: anchor it here so the scan can
  // never escape into whatever encloses the system temp directory.
  mkdirSync(join(root, ".git"));
  put("AGENTS.md", "# Project rules\n\nUse pnpm. Keep modules small.\n");
  put("CLAUDE.md", "# Project rules\n\nUse npm. Prefer big modules.\n");
  put(".claude/settings.json", "{}\n");
  put(".mcp.json", '{ "mcpServers": {} }\n');
  put(".claude/skills/demo/SKILL.md", "# Demo skill\n\nSays hello.\n");
  put(".cursor/rules/style.mdc", "---\ndescription: style\n---\nPrefer named exports.\n");
  put(
    ".github/instructions/ts.instructions.md",
    "---\napplyTo: '**/*.ts'\n---\nUse strict mode.\n",
  );
  put("src/deep/a/b/c/d/AGENTS.md", "# Deep directory rules\n");
  for (let d = 0; d < 500; d++) {
    const dir = `src/mod${String(d).padStart(3, "0")}`;
    for (let f = 0; f < 10; f++) {
      put(`${dir}/file${f}.ts`, `export const value${d}x${f} = ${f};\n`);
    }
    if (d % 25 === 0) put(`${dir}/AGENTS.md`, `# Rules for module ${d}\n`);
    if (d % 50 === 0) put(`${dir}/notes.mdc`, `Stray cursor notes for module ${d}.\n`);
  }
  for (let f = 0; f < 300; f++) {
    put(`node_modules/dep${f % 10}/file${f}.js`, "module.exports = 0;\n");
  }
  put("node_modules/decoy/AGENTS.md", "# Must never be inventoried\n");
  return root;
}

describe.runIf(process.env["GITMESH_DOCTOR_PERF"] === "1")(
  "gitmesh doctor - performance guard (T1.18)",
  () => {
    let root: string;
    beforeAll(() => {
      root = buildFixture();
    }, 60_000);
    afterAll(() => {
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    });

    it("audits a 5k-file repository in under 2 seconds", { timeout: 120_000 }, async () => {
      // Imported here, not at module top level, so the gated-off run in the
      // regular suite never loads the doctor/adapters module graph at all.
      const { runDoctor } = await import("../workspace/doctor.js");

      // Warm-up, untimed: the first call pays vitest's on-demand transform
      // and the registry's lazy dynamic import of every adapter module -
      // module loading the shipped esbuild bundle does not do at scan time,
      // and not what the budget is about. It doubles as the correctness
      // probe: a guard that times an empty or mis-rooted scan proves nothing.
      const warm = await runDoctor({ dir: root, color: false, context: HERMETIC });
      const paths = warm.report.artifacts.map((artifact) => artifact.path);
      expect(paths).toContain("AGENTS.md");
      expect(paths).toContain("src/deep/a/b/c/d/AGENTS.md");
      const agentsDocs = new Set(paths.filter((path) => path.endsWith("AGENTS.md")));
      expect(agentsDocs.size).toBeGreaterThanOrEqual(22); // root + deep + 20 nested
      expect(paths.filter((path) => path.startsWith("node_modules/"))).toEqual([]);
      expect(warm.report.findings.map((finding) => finding.ruleId)).toContain("GM010");
      const labels = warm.report.drift.documents.map((doc) => doc.label);
      expect(labels).toEqual(expect.arrayContaining(["AGENTS.md", "CLAUDE.md"]));
      expect(warm.exitCode).toBe(1);

      // Min of a few runs: noise on a shared runner only ever inflates a
      // sample, so the fastest run is the honest "can doctor do this" number.
      const samples: number[] = [];
      for (let run = 0; run < TIMED_RUNS; run++) {
        const started = performance.now();
        await runDoctor({ dir: root, color: false, context: HERMETIC });
        samples.push(performance.now() - started);
      }
      const best = Math.min(...samples);
      // The measured numbers belong in the CI log (surfaced by the
      // --silent=false --reporter=verbose flags in the test:perf script).
      console.log(
        `doctor on the 5k-file fixture: ${samples.map((ms) => ms.toFixed(0)).join(" / ")} ms`,
      );
      expect(best).toBeLessThan(BUDGET_MS);
    });
  },
);

/**
 * The fragmentation census (pivot §12 T2.4): `gitmesh doctor` across the
 * most-starred open-source repositories that ship an AGENTS.md, aggregated
 * into drift and risk statistics anyone can reproduce. Maintainer tool, run
 * by hand: no package ships it and no CI job runs it. It needs the network
 * (the GitHub API and git fetches); doctor itself, as everywhere, does not.
 *
 *   pnpm census discover  --out <manifest.json> [--limit 500]
 *   pnpm census scan      --manifest <manifest.json> --results <dir> [--work <dir>] [--concurrency 4]
 *   pnpm census aggregate --manifest <manifest.json> --results <dir> --out <dir>
 *
 * Method and reproduction steps: scripts/census/README.md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { aggregate } from "./aggregate.js";
import { discover, githubSearch } from "./discover.js";
import { readManifest } from "./manifest.js";
import { renderStatsMarkdown } from "./render.js";
import { readResults } from "./result.js";
import { scan } from "./scan.js";

const USAGE = `Usage:
  pnpm census discover  --out <manifest.json> [--limit 500]
      needs GITHUB_TOKEN or GH_TOKEN, e.g. GITHUB_TOKEN=$(gh auth token)
  pnpm census scan      --manifest <manifest.json> --results <dir> [--work <dir>] [--concurrency 4]
  pnpm census aggregate --manifest <manifest.json> --results <dir> --out <dir>`;

function fail(message: string): never {
  console.error(`census: ${message}\n\n${USAGE}`);
  process.exit(2);
}

function required(values: Record<string, string | undefined>, name: string): string {
  return values[name] ?? fail(`--${name} is required`);
}

function positiveInteger(value: string, name: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) fail(`--${name} must be a positive integer, got "${value}"`);
  return number;
}

const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === "discover") {
    const { values } = parseArgs({
      args: rest,
      options: { out: { type: "string" }, limit: { type: "string", default: "500" } },
    });
    const out = required(values, "out");
    const limit = positiveInteger(values.limit, "limit");
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || fail("discover needs GITHUB_TOKEN or GH_TOKEN");
    const today = new Date().toISOString().slice(0, 10);
    const manifest = await discover(githubSearch(token), limit, today);
    writeJson(out, manifest);
    console.error(`discover: wrote ${manifest.repositories.length} repositories to ${out}`);
    if (manifest.repositories.length < limit) {
      console.error(`discover: only ${manifest.repositories.length} of ${limit} found above the star floor`);
    }
    return;
  }
  if (command === "scan") {
    const { values } = parseArgs({
      args: rest,
      options: {
        manifest: { type: "string" },
        results: { type: "string" },
        work: { type: "string" },
        concurrency: { type: "string", default: "4" },
      },
    });
    const manifest = readManifest(required(values, "manifest"));
    await scan(manifest, {
      resultsDir: required(values, "results"),
      workDir: values.work,
      concurrency: positiveInteger(values.concurrency, "concurrency"),
    });
    return;
  }
  if (command === "aggregate") {
    const { values } = parseArgs({
      args: rest,
      options: { manifest: { type: "string" }, results: { type: "string" }, out: { type: "string" } },
    });
    const manifest = readManifest(required(values, "manifest"));
    const out = required(values, "out");
    const stats = aggregate(manifest, readResults(manifest, required(values, "results")));
    mkdirSync(out, { recursive: true });
    writeJson(join(out, "stats.json"), stats);
    writeFileSync(join(out, "stats.md"), renderStatsMarkdown(stats));
    console.error(`aggregate: ${stats.repositories.scanned} repositories; wrote stats.json and stats.md to ${out}`);
    return;
  }
  fail(command === undefined ? "no command given" : `unknown command "${command}"`);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`census: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

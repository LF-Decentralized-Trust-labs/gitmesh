/**
 * esbuild configuration for building the gitmesh-agents CLI for npm.
 *
 * Bundles all workspace packages (@gitmesh/*) into a single file.
 * External npm packages remain as regular dependencies.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Workspace packages whose code should be bundled into the CLI.
// Note: "server" is excluded — it's published separately and resolved at runtime.
const workspacePaths = [
  "cli",
  "lib/data",
  "lib/core",
  "lib/adapter-sdk",
  "lib/adapters/claude",
  "lib/adapters/codex",
  "lib/adapters/gateway",
  "lib/adapters/cursor",
  "lib/adapters/opencode",
  "lib/adapters/pi",
];

// Workspace packages that should NOT be bundled — they'll be published
// to npm and resolved at runtime (e.g. @gitmesh/server uses dynamic import).
const externalWorkspacePackages = new Set([
  "@gitmesh/server",
]);

// Collect all external (non-workspace) npm package names
const externals = new Set();
for (const p of workspacePaths) {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, p, "package.json"), "utf8"));
  for (const name of Object.keys(pkg.dependencies || {})) {
    if (externalWorkspacePackages.has(name)) {
      externals.add(name);
    } else if (!name.startsWith("@gitmesh/")) {
      externals.add(name);
    }
  }
  for (const name of Object.keys(pkg.optionalDependencies || {})) {
    externals.add(name);
  }
}
// Also add all published workspace packages as external
for (const name of externalWorkspacePackages) {
  externals.add(name);
}

/** @type {import('esbuild').BuildOptions} */
export default {
  entryPoints: ["src/index.ts", "src/gitmesh.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outdir: "dist",
  splitting: true,
  banner: { js: "#!/usr/bin/env node" },
  external: [...externals].sort(),
  treeShaking: true,
  sourcemap: true,
};

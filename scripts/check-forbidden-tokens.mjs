#!/usr/bin/env node
/**
 * check-forbidden-tokens.mjs
 *
 * Scans the codebase for forbidden tokens before publishing to npm.
 * Mirrors the git pre-commit hook logic, but runs against the full
 * working tree (not just staged changes).
 *
 * Token list (preferred): scripts/forbidden-tokens.txt (one per line, # comments ok).
 * Legacy fallback: .git/hooks/forbidden-tokens.txt.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

let repoRoot = process.cwd();
let gitDir = ".git";
let useGitGrep = true;

try {
  repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  gitDir = execSync("git rev-parse --git-dir", { encoding: "utf8", cwd: repoRoot }).trim();
} catch {
  useGitGrep = false;
}

const repoTokensFile = resolve(repoRoot, "scripts/forbidden-tokens.txt");
const hooksTokensFile = resolve(repoRoot, gitDir, "hooks/forbidden-tokens.txt");
const tokensFile = existsSync(repoTokensFile) ? repoTokensFile : hooksTokensFile;

if (!existsSync(tokensFile)) {
  console.log("  ℹ  Forbidden tokens list not found - skipping check.");
  process.exit(0);
}

function parseTokenEntry(line) {
  if (line.startsWith("hex:")) {
    return Buffer.from(line.slice(4), "hex").toString("utf8");
  }
  return line;
}

const ignoredPaths = [
  "pnpm-lock.yaml",
  "**/.git/**",
  "**/dist/**",
  "**/*.tsbuildinfo",
  "Backup/**",
  "gitmesh_old/**",
  // Exclude the token list and the scanner itself so they never match themselves.
  "scripts/forbidden-tokens.txt",
  "scripts/check-forbidden-tokens.mjs",
  // Census manifests list third-party repositories by name (pivot T2.4), and
  // other projects' names are not ours to change. The census statistics and
  // write-ups name no repositories and stay covered.
  "doc/census/*/manifest.json",
];
const gitIgnoreArgs = ignoredPaths.map((path) => `':!${path}'`).join(" ");
const rgIgnoreArgs = ignoredPaths.map((path) => `--glob '!${path}'`).join(" ");

const tokens = readFileSync(tokensFile, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map(parseTokenEntry);

if (tokens.length === 0) {
  console.log("  ℹ  Forbidden tokens list is empty - skipping check.");
  process.exit(0);
}

console.log(`  ℹ  Using forbidden token list: ${tokensFile.replace(`${repoRoot}/`, "")}`);
if (!useGitGrep) {
  console.log("  ℹ  Git metadata not found; using ripgrep fallback scan.");
}

// Use git grep to search tracked files only (avoids node_modules, dist, etc.)
let found = false;

for (const token of tokens) {
  try {
    const result = useGitGrep
      ? execSync(
          `git grep -in --no-color -- ${JSON.stringify(token)} -- ${gitIgnoreArgs}`,
          { encoding: "utf8", cwd: repoRoot, stdio: ["pipe", "pipe", "pipe"] },
        )
      : execSync(
          `rg -n --hidden --no-heading --color never -F -- ${JSON.stringify(token)} . ${rgIgnoreArgs}`,
          { encoding: "utf8", cwd: repoRoot, stdio: ["pipe", "pipe", "pipe"] },
        );
    if (result.trim()) {
      if (!found) {
        console.error("ERROR: Forbidden tokens found in tracked files:\n");
      }
      found = true;
      // Print matches but DO NOT print which token was matched (avoids leaking the list)
      const lines = result.trim().split("\n");
      for (const line of lines) {
        console.error(`  ${line}`);
      }
    }
  } catch {
    // git grep returns exit code 1 when no matches - that's fine
  }
}

if (found) {
  console.error("\nBuild blocked. Remove the forbidden token(s) before publishing.");
  process.exit(1);
} else {
  console.log("  ✓  No forbidden tokens found.");
}

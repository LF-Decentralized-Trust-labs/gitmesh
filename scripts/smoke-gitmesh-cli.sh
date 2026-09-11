#!/usr/bin/env bash
set -euo pipefail

# smoke-gitmesh-cli.sh - clean-install smoke test for the gitmesh-cli package
# (pivot T0.6).
#
# Builds packages/gitmesh-cli, packs the exact tarball `npm publish` would
# ship, installs it into a fresh temp project with plain npm (no workspace
# links, dependencies resolved from the registry), and asserts the installed
# `gitmesh` binary behaves. This is what proves `npx gitmesh-cli@next` will
# work before anything is published.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG_DIR="$REPO_ROOT/packages/gitmesh-cli"

echo "==> Building gitmesh-cli"
pnpm --filter gitmesh-cli build

EXPECTED_VERSION="$(node -p "require('$PKG_DIR/package.json').version")"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "==> Packing tarball"
(cd "$PKG_DIR" && npm pack --pack-destination "$WORKDIR" >/dev/null)

echo "==> Installing into a clean project ($WORKDIR)"
cd "$WORKDIR"
npm init -y >/dev/null
npm install --no-fund --no-audit --loglevel=error ./gitmesh-cli-*.tgz

GITMESH="$WORKDIR/node_modules/.bin/gitmesh"

echo "==> gitmesh --version"
ACTUAL_VERSION="$("$GITMESH" --version)"
if [ "$ACTUAL_VERSION" != "$EXPECTED_VERSION" ]; then
  echo "FAIL: gitmesh --version printed '$ACTUAL_VERSION', expected '$EXPECTED_VERSION'" >&2
  exit 1
fi

echo "==> gitmesh --help lists the pivot subcommands"
HELP_OUTPUT="$("$GITMESH" --help)"
for subcommand in doctor init migrate apply check policy legacy; do
  if ! grep -q "$subcommand" <<<"$HELP_OUTPUT"; then
    echo "FAIL: gitmesh --help does not mention '$subcommand'" >&2
    exit 1
  fi
done

# `doctor` audits the enclosing git root, so the audited tree has to be pinned:
# without a `.git` here, a $TMPDIR that happens to sit inside a checkout (a
# dotfiles repo, a workspace-rooted RUNNER_TEMP) would make this audit -- and
# its exit code -- depend on that repo's contents.
git init -q "$WORKDIR/clean"
cd "$WORKDIR/clean"

echo "==> gitmesh doctor --json audits a clean project and exits 0"
if ! DOCTOR_OUTPUT="$("$GITMESH" doctor --json)"; then
  echo "FAIL: gitmesh doctor --json exited non-zero on a repository with no agent config" >&2
  echo "$DOCTOR_OUTPUT" | head -c 500 >&2
  exit 1
fi
if ! grep -q '"schemaVersion"' <<<"$DOCTOR_OUTPUT"; then
  echo "FAIL: gitmesh doctor --json did not print a schema-versioned report; got:" >&2
  echo "$DOCTOR_OUTPUT" | head -c 500 >&2
  exit 1
fi

# The packaged binary must also *propagate* a non-zero exit: `doctor` sets
# process.exitCode rather than calling process.exit, and that is the contract
# the CI drift gate is built on. No unit test covers a real process exit.
echo "==> gitmesh doctor exits 1 when a finding fires"
printf '{"mcpServers":{"github":{"command":"npx","env":{"GITHUB_TOKEN":"ghp_%s"}}}}\n' \
  "FAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKE01" >.mcp.json
if "$GITMESH" doctor --json >/dev/null 2>&1; then
  echo "FAIL: gitmesh doctor exited 0 on a repository with a plaintext-secret finding" >&2
  exit 1
fi
rm -f .mcp.json
cd "$WORKDIR"

echo "PASS: gitmesh-cli@$EXPECTED_VERSION installs clean and runs"

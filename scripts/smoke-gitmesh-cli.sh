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

GITMESH="./node_modules/.bin/gitmesh"

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

echo "==> gitmesh doctor --json audits the empty project and exits 0"
set +e
DOCTOR_OUTPUT="$("$GITMESH" doctor --json)"
DOCTOR_EXIT=$?
set -e
if [ "$DOCTOR_EXIT" -ne 0 ] || ! grep -q '"schemaVersion": 1' <<<"$DOCTOR_OUTPUT"; then
  echo "FAIL: gitmesh doctor --json exited $DOCTOR_EXIT without a schema v1 report" >&2
  exit 1
fi

echo "PASS: gitmesh-cli@$EXPECTED_VERSION installs clean and runs"

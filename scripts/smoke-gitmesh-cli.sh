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
#
# It also holds the package to ADR-006 (no telemetry, pivot T2.3). Every
# gitmesh run below happens under scripts/network-spy.mjs, which ends the
# process with exit 97 on the first network, DNS, listening-socket,
# subprocess or worker-thread call, and every command `gitmesh --help` lists
# gets a run of its own. CI runs this script on every pull request and the
# release workflow runs it before every publish.

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

# ADR-006 covers install time too. npm's lockfile flags every package with a
# preinstall, install or postinstall script (or a binding.gyp to build).
echo "==> No installed package runs an install script"
INSTALL_SCRIPTS="$(node -p '
  const { packages = {} } = require("./package-lock.json");
  Object.keys(packages).filter((path) => packages[path].hasInstallScript).join(" ")
')"
if [ -n "$INSTALL_SCRIPTS" ]; then
  echo "FAIL: npm install of gitmesh-cli runs install scripts from: $INSTALL_SCRIPTS" >&2
  exit 1
fi

SPY="$WORKDIR/network-spy.mjs"
cp "$REPO_ROOT/scripts/network-spy.mjs" "$SPY"
OUT="$WORKDIR/stdout"
ERR="$WORKDIR/stderr"

# run_gitmesh ARGS... runs the installed binary under the network spy, with
# no stdin, its stdout in $OUT and its stderr in $ERR, and returns its exit
# status. A spy trip ends the smoke test here, whatever the caller does with
# that status.
run_gitmesh() {
  local status=0
  NODE_OPTIONS="--import=\"$SPY\"" "$GITMESH" "$@" </dev/null >"$OUT" 2>"$ERR" || status=$?
  if [ "$status" -eq 97 ] || grep -q "gitmesh network-spy:" "$ERR"; then
    echo "FAIL: gitmesh $* used the network, a subprocess or a worker thread (ADR-006):" >&2
    cat "$ERR" >&2
    exit 1
  fi
  return "$status"
}

# Without this, a spy that failed to load would make every check below pass.
echo "==> The network spy is live"
SPY_STATUS=0
NODE_OPTIONS="--import=\"$SPY\"" node -e 'fetch("http://127.0.0.1:59999/").catch(() => {})' \
  2>"$ERR" || SPY_STATUS=$?
if [ "$SPY_STATUS" -ne 97 ] || ! grep -q "gitmesh network-spy: fetch called" "$ERR"; then
  echo "FAIL: a fetch under the network spy exited $SPY_STATUS, not 97 with a spy report:" >&2
  cat "$ERR" >&2
  exit 1
fi

echo "==> gitmesh --version"
run_gitmesh --version
ACTUAL_VERSION="$(cat "$OUT")"
if [ "$ACTUAL_VERSION" != "$EXPECTED_VERSION" ]; then
  echo "FAIL: gitmesh --version printed '$ACTUAL_VERSION', expected '$EXPECTED_VERSION'" >&2
  exit 1
fi

echo "==> gitmesh --help lists the pivot subcommands"
run_gitmesh --help
HELP_OUTPUT="$(cat "$OUT")"
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
if ! run_gitmesh doctor --json; then
  echo "FAIL: gitmesh doctor --json exited non-zero on a repository with no agent config" >&2
  head -c 500 "$OUT" >&2
  exit 1
fi
if ! grep -q '"schemaVersion"' "$OUT"; then
  echo "FAIL: gitmesh doctor --json did not print a schema-versioned report; got:" >&2
  head -c 500 "$OUT" >&2
  exit 1
fi

# The packaged binary must also *propagate* a non-zero exit: `doctor` sets
# process.exitCode rather than calling process.exit, and that is the contract
# the CI drift gate is built on. No unit test covers a real process exit.
echo "==> gitmesh doctor exits 1 when a finding fires"
printf '{"mcpServers":{"github":{"command":"npx","env":{"GITHUB_TOKEN":"ghp_%s"}}}}\n' \
  "FAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKE01" >.mcp.json
if run_gitmesh doctor --json; then
  echo "FAIL: gitmesh doctor exited 0 on a repository with a plaintext-secret finding" >&2
  exit 1
fi

echo "==> gitmesh doctor renders every output mode without network use"
mkdir -p "$WORKDIR/home/.claude"
printf '# Personal\n' >"$WORKDIR/home/.claude/CLAUDE.md"
run_gitmesh doctor || true
run_gitmesh doctor --md || true
HOME="$WORKDIR/home" run_gitmesh doctor --user || true
if ! grep -qF "~/.claude/CLAUDE.md" "$OUT"; then
  echo "FAIL: gitmesh doctor --user did not inventory the test home's ~/.claude/CLAUDE.md" >&2
  exit 1
fi
rm -f .mcp.json

# Reading the list from --help means a new command is covered the day it
# lands. Each one runs bare and with --help in an empty repo of its own, so
# commands that write files (init, apply, once they exist) have somewhere
# harmless to write.
echo "==> Every gitmesh command runs without network use"
COMMANDS="$(awk '/^Commands:/ { listing = 1; next } listing && /^  [a-z]/ { print $1 }' <<<"$HELP_OUTPUT")"
if ! grep -qx doctor <<<"$COMMANDS"; then
  echo "FAIL: could not read the command list from gitmesh --help; got: $COMMANDS" >&2
  exit 1
fi
git init -q "$WORKDIR/commands"
cd "$WORKDIR/commands"
for command in $COMMANDS; do
  run_gitmesh "$command" --help || true
  run_gitmesh "$command" || true
done
cd "$WORKDIR"

echo "PASS: gitmesh-cli@$EXPECTED_VERSION installs clean and runs; no network use in: ${COMMANDS//$'\n'/, }"

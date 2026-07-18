#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [lockfile-dir]" >&2
  exit 2
fi

lockfile_args=(--lockfile-only)
if [[ $# -eq 1 ]]; then
  lockfile_args+=(--lockfile-dir "$1")
fi

install_log="$(mktemp)"
trap 'rm -f "$install_log"' EXIT

set +e
pnpm install "${lockfile_args[@]}" --frozen-lockfile >"$install_log" 2>&1
install_status=$?
set -e
cat "$install_log"

if [[ $install_status -eq 0 ]]; then
  exit 0
fi

if ! grep -Eq "ERR_PNPM_(OUTDATED_LOCKFILE|LOCKFILE_CONFIG_MISMATCH)" "$install_log"; then
  exit "$install_status"
fi

echo "Package manifests changed; resolving the shared CI lockfile."
pnpm install "${lockfile_args[@]}" --no-frozen-lockfile
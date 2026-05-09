#!/bin/sh
set -e

# Ensure the data volume is owned by the gitmesh user.
# When Docker creates a host bind-mount directory it is root-owned,
# so we fix ownership here before dropping privileges.
if [ "$(id -u)" = "0" ]; then
  chown -R gitmesh:gitmesh /gitmesh-agents
  exec gosu gitmesh "$@"
else
  exec "$@"
fi

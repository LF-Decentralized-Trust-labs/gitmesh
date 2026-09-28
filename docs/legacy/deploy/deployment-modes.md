---
title: Deployment Modes
summary: local_trusted vs authenticated (private/public)
---

GitMesh Agents supports two runtime modes with different security profiles.

## `local_trusted`

The default mode. Optimized for single-operator local use.

- **Host binding**: loopback only (localhost)
- **Authentication**: no login required
- **Use case**: local development, solo experimentation
- **Operator identity**: auto-created local operator user

```sh
# Set during onboard
pnpm gitmesh-agents onboard
# Choose "local_trusted"
```

## `authenticated`

Login required. Supports two exposure policies.

### `authenticated` + `private`

For private network access (Tailscale, VPN, LAN).

- **Authentication**: login required via Better Auth
- **URL handling**: auto base URL mode (lower friction)
- **Host trust**: private-host trust policy required

```sh
pnpm gitmesh-agents onboard
# Choose "authenticated" -> "private"
```

Allow custom Tailscale hostnames:

```sh
pnpm gitmesh-agents allowed-hostname my-machine
```

### `authenticated` + `public`

For internet-facing deployment.

- **Authentication**: login required
- **URL**: explicit public URL required
- **Security**: stricter deployment checks in doctor

```sh
pnpm gitmesh-agents onboard
# Choose "authenticated" -> "public"
```

## Operator Claim Flow

When migrating from `local_trusted` to `authenticated`, GitMesh Agents emits a one-time claim URL at startup:

```
/operator-claim/<token>?code=<code>
```

A signed-in user visits this URL to claim operator ownership. This:

- Promotes the current user to instance admin
- Demotes the auto-created local operator admin
- Ensures active project membership for the claiming user

## Changing Modes

Update the deployment mode:

```sh
pnpm gitmesh-agents configure --section server
```

Runtime override via environment variable:

```sh
GITMESH_DEPLOYMENT_MODE=authenticated pnpm gitmesh-agents run
```

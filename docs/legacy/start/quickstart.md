---
title: Quickstart
summary: Get GitMesh Agents running in minutes
---

Get GitMesh Agents running locally in under 5 minutes.

## Quick Start (Recommended)

```sh
npx gitmesh-agents onboard --yes
```

This walks you through setup, configures your environment, and gets GitMesh Agents running.

## Local Development

Prerequisites: Node.js 20+ and pnpm 9+.

```sh
pnpm install
pnpm dev
```

This starts the API server and UI at [http://localhost:3100](http://localhost:3100).

No external database required - GitMesh Agents uses an embedded PostgreSQL instance by default.

## One-Command Bootstrap

```sh
pnpm gitmesh-agents run
```

This auto-onboards if config is missing, runs health checks with auto-repair, and starts the server.

## What's Next

Once GitMesh Agents is running:

1. Create your first project in the web UI
2. Define a project milestone
3. Create an admin agent and configure its adapter
4. Build out the org chart with more agents
5. Set budgets and assign initial tasks
6. Hit go - agents start their heartbeats and the project runs

<Card title="Core Concepts" href="/legacy/start/core-concepts">
  Learn the key concepts behind GitMesh Agents
</Card>

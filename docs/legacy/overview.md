---
title: "Legacy: the GitMesh Agents runtime"
sidebarTitle: Overview
description: "The pages in this tab document the pre-pivot GitMesh Agents runtime - server, database, dashboard and orchestrated agent roles - which is in maintenance mode."
---

The pages in this tab document **GitMesh Agents**: the multi-agent orchestration
runtime, governed MCP server, PostgreSQL-backed control plane and maintainer
dashboard that GitMesh shipped before the pivot. They are kept because the code
is still in the repository and still runs.

They no longer describe the product GitMesh is building. GitMesh is now the
**agent workspace compiler**: a single CLI that audits, compiles and drift-checks
coding-agent configuration from the repository, with no server, no database and
no daemon. Start at the [doctor quickstart](/doctor/quickstart).

What this means in practice:

- The runtime is in maintenance mode. Its commands live under `gitmesh legacy`,
  and nothing in the new CLI path requires a server or a database.
- These pages are not updated against the pivot. Where they contradict
  `doc/pivot/pivot.md`, the pivot document is correct.
- Nothing here is being deleted without notice. The pivot plan extracts the
  runtime to a separate package only after two silent releases.

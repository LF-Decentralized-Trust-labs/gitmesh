<div align="center">

<picture>
   <source srcset="public/light_logo.png" media="(prefers-color-scheme: dark)">
   <img src="public/dark_logo.png" alt="GitMesh Logo" width="250">
</picture>

# GitMesh Community Edition

[![OpenSource License](https://img.shields.io/badge/License-Apache%20License-orange.svg?style=for-the-badge)](LICENSE.md)
[![Contributors](https://img.shields.io/github/contributors/LF-Decentralized-Trust-labs/gitmesh.svg?style=for-the-badge&logo=git)](https://github.com/LF-Decentralized-Trust-labs/gitmesh/graphs/contributors)
[![Alpha Release](https://img.shields.io/badge/Status-Alpha%20Version-yellow.svg?style=for-the-badge)](#)
[![OpenSSF Best Practices](https://img.shields.io/badge/OpenSSF-Silver%20Best%20Practices-silver.svg?style=for-the-badge&logo=opensourceinitiative)](https://www.bestpractices.dev/projects/10972)

### Build what wins, not what's loud.

[![Join Waitlist](https://img.shields.io/badge/Join_Waitlist-000000?style=flat&logo=mailchimp&logoColor=white)](https://www.alveoli.app)
[![Join Weekly Dev Call](https://img.shields.io/badge/Join_Weekly_Dev_Call-000000?style=flat&logo=zoom&logoColor=white)](https://zoom-lfx.platform.linuxfoundation.org/meeting/96608771523?password=211b9c60-b73a-4545-8913-75ef933f9365)

</div>

---

## What is GitMesh?

**GitMesh Community Edition** is an open-source multi-agent orchestration runtime and governed MCP server purpose-built for open source projects. It enables AI agent teams — Triage, PR Review, Docs, Security, Community, Onboarding, and Release — to handle maintainer work autonomously, with every connected tool (Claude Code, Copilot, Cursor, Codex, Gemini CLI, and more) governed by a single maintainer-defined Policy-as-Code layer via OPA.

Built on a proven orchestration engine with atomic task checkout, persistent agent context, heartbeat scheduling, and budget enforcement, GitMesh extends this foundation with native GitHub/GitLab integration and distributes governance through MCP and ACP compatibility with every major AI coding tool. Any project can adopt it with one YAML file and one CI step.

### Core Capabilities

- **Multi-Agent Orchestration** — Pre-defined OSS agent roles (Triage, PR Review, Docs, Security, Community, Onboarding, Release) with configurable heartbeat schedules, token budgets, and permission scopes
- **Policy-as-Code via OPA** — Maintainers define governance rules in simple YAML that auto-compiles to Rego. No agent merges a PR, modifies CI/CD files, or publishes a security advisory without human approval
- **GitHub/GitLab Native Sync** — Bidirectional issue and PR synchronization via webhooks. Agent actions (label, comment, review) push directly to the forge
- **MCP Server** — Any MCP-compatible IDE (VS Code, Cursor, JetBrains) connects once and every AI tool is automatically governed by the project's policy
- **ACP Orchestrator** — JSON-RPC 2.0 agent-to-agent coordination. Multiple agents work simultaneously without conflicts, double work, or runaway costs
- **Immutable Audit Log** — Every action logged with actor, policy version, and outcome (allowed/blocked). Filterable and exportable as JSON/CSV
- **Project Templates** — Pre-configured agent teams for CLI tools, JS libraries, DevOps projects, CNCF sandboxes, and solo maintainers. One-click adoption

### Three-View Dashboard

| View | Purpose |
|------|---------|
| **Active Agents** | Agent status, budget consumption, current work. One-click pause, terminate, or reconfigure |
| **Pending Approvals** | Mobile-first approval queue — merge PRs, CVE disclosures, issue closures. Clear in 5 minutes |
| **Audit Log** | Chronological action history with policy outcome filtering |

---

## Quick Installation

> Currently supports Linux-based systems only. [See issue #199](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues/199)

### System Requirements

Before joining the pack, ensure you have:

- **Node.js LTS** – [Download here](https://nodejs.org/en/download/)
  - Verify installation: `echo $PATH` (look for `/usr/local/bin`)
- **Docker & Docker Compose** – [Installation guide](https://docs.docker.com/get-docker/)
- **Git** – [Git Download](https://git-scm.com/downloads)
- **Ollama** *(optional, for local AI features)* – [Download here](https://ollama.com/download)

### Ollama Setup (Optional — Local AI)

GitMesh uses Ollama for local AI-powered features (issue prioritization, sprint suggestions, spec generation). Ollama runs **on your host system** (not in Docker) for better performance and GPU support.

<details>
<summary><strong>Install & Configure Ollama</strong></summary>

**1. Install Ollama on your host:**

```bash
# Linux
curl -fsSL https://ollama.com/install.sh | sh

# Or download from https://ollama.com/download
```

**2. Pull a model:**

```bash
ollama pull llama3.2:3b
```

**3. Verify it's running:**

```bash
curl http://localhost:11434
# Should return: "Ollama is running"
```

**4. Enable Ollama in GitMesh:**

Add these environment variables to your backend override file (`backend/.env.override.local` or `backend/.env.override.composed`):

```bash
OLLAMA_ENABLED=true
OLLAMA_URL=http://host.docker.internal:11434
OLLAMA_MODEL=llama3.2:3b
```

> **Linux Docker users:** If `host.docker.internal` doesn't resolve, add `--add-host=host.docker.internal:host-gateway` to your Docker run command, or use your host's LAN IP (e.g., `http://192.168.1.x:11434`).

**Without Ollama:** GitMesh works perfectly fine without it. If no AI provider is configured, workflow endpoints return deterministic fallback responses. You can also use cloud providers (OpenAI, Anthropic, Groq, etc.) by setting their API keys.

</details>

### Launch Sequence

```bash
git clone [YOUR_REPO]
cd scripts
./cli clean-dev
```

Access your instance at `http://localhost:8081`

> **Note: Slack Integration Setup**
>
> To enable Slack functionality, you must expose your local server via HTTPS (e.g., using [ngrok](https://ngrok.com/)):
>
> `ngrok http 8080`
>
> Afterwards, configure your Slack app's redirect URL with the generated `https://...ngrok.io/slack/callback` endpoint and update `slack_redirect_url` in your local configuration.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Server | Node.js + Express 5 + TypeScript (ESM) |
| ORM / Database | Drizzle ORM + PostgreSQL (external or embedded) |
| Auth | better-auth (humans) · HMAC-SHA256 JWTs (agents) |
| Validation | Zod schemas (`@gitmesh/agents-shared`) |
| Realtime | WebSocket (`ws`) live events |
| UI | React 19 + Vite 6 + Tailwind v4 + shadcn/ui |
| Data Fetching | TanStack React Query v5 |
| CLI | Commander.js |
| Build | tsc (prod) · tsx (dev) · esbuild (CLI) |
| Test | Vitest + Supertest |

---

## Command Arsenal

<details>
<summary><strong>Development Workflows</strong></summary>

| Command | Purpose |
|---------|---------|
| `./cli prod` | Launch production environment |
| `./cli dev` | Start with hot reloading enabled |
| `./cli clean-dev` | Fresh development start |

</details>

<details>
<summary><strong>Backend Operations</strong></summary>

| Command | Purpose |
|---------|---------|
| `./cli prod-backend` | Production backend only |
| `./cli dev-backend` | Development backend with hot reload |
| `./cli clean-dev-backend` | Clean backend restart |

</details>

<details>
<summary><strong>Testing Suite</strong></summary>

| Command | Purpose |
|---------|---------|
| `./cli start-e2e` | Initialize E2E testing environment |
| `./cli start-be` | Backend testing mode |

</details>

<details>
<summary><strong>Infrastructure Management</strong></summary>

| Command | Purpose |
|---------|---------|
| `./cli scaffold up` | Start infrastructure services |
| `./cli scaffold down` | Stop infrastructure services |
| `./cli scaffold destroy` | Remove all volumes and data |
| `./cli scaffold reset` | Complete infrastructure refresh |
| `./cli scaffold up-test` | Test infrastructure initialization |

</details>

<details>
<summary><strong>Database Control</strong></summary>

| Command | Purpose |
|---------|---------|
| `./cli scaffold create-migration <name>` | Generate migration files |
| `./cli scaffold migrate-up` | Execute pending migrations |
| `./cli db-backup <name>` | Create database backup |
| `./cli db-restore <name>` | Restore from backup |

</details>

<details>
<summary><strong>Service Orchestration</strong></summary>

| Command | Purpose |
|---------|---------|
| `./cli service <name> up` | Launch specific service |
| `./cli service <name> down` | Stop specific service |
| `./cli service <name> restart` | Restart service |
| `./cli service <name> logs` | Stream service logs |
| `./cli service <name> status` | Check service health |
| `./cli service list` | View all active services |
| `./cli service up-all` | Start complete service stack |

</details>

<details>
<summary><strong>Build & Deploy</strong></summary>

| Command | Purpose |
|---------|---------|
| `./cli build <service> [version]` | Build service container |
| `./cli build-and-push <service> [version]` | Build and publish to registry |

</details>

### Emergency Reset

Nuclear option to clear all containers:

```bash
docker rm -f $(docker ps -aq)
```

### Stay Current

Keep your local instance synchronized with the latest updates:

```bash
# Preserve local changes
git stash

# Pull latest updates
git pull

# Restore your changes
git stash pop
```

---

## Adoption Path

| Stage | What Happens | Time |
|-------|-------------|------|
| **1. Zero-config entry** | Add `gitmesh/agent-gate` to CI — contributions are policy-checked immediately | 5 min |
| **2. First agent** | Add `.gitmesh/agents.yaml`, enable Triage Agent, approve onboarding | 15 min |
| **3. Connect tools** | Each developer adds GitMesh MCP server URL to their IDE config once | 2 min/dev |
| **4. Expand the team** | Enable PR Review, Docs, Security agents as the project grows | On demand |
| **5. Publish a template** | Share your agent configuration for other projects to adopt | Optional |

---

## Join the Pack

We believe the strongest solutions emerge from diverse perspectives working in concert. Whether you're fixing a bug, proposing a feature, or improving documentation, your contribution matters.

[![LFX Active Contributors](https://insights.linuxfoundation.org/api/badge/active-contributors?project=lf-decentralized-trust-labs&repos=https://github.com/LF-Decentralized-Trust-labs/gitmesh)](https://insights.linuxfoundation.org/project/lf-decentralized-trust-labs/repository/lf-decentralized-trust-labs-gitmesh)
[![GitMesh CE Governance](https://img.shields.io/github/actions/workflow/status/LF-Decentralized-Trust-labs/gitmesh/gov-sync.yml?label=GitMesh%20CE%20Governance)](https://github.com/LF-Decentralized-Trust-labs/gitmesh/actions/workflows/gov-sync.yml)
[![Complete Roadmap](https://img.shields.io/badge/View_our-Roadmap-blue?logo=github&logoColor=white)](https://github.com/LF-Decentralized-Trust-labs/gitmesh/blob/main/ROADMAP.md)

### Contribution Path

1. Fork the repository
2. Create your feature branch: `git checkout -b type/branch-name`
3. Commit your changes with sign-off: `git commit -s -m 'Add innovative feature'`
4. Push to your branch: `git push origin type/branch-name`
5. Open a signed pull request

Read our detailed [Contributing Guide](CONTRIBUTING.md) for best practices and guidelines.

---

## Maintainers

<table width="100%">
  <tr align="center">
    <td valign="top" width="33%">
      <a href="https://github.com/parvm1102" target="_blank">
        <img src="https://avatars.githubusercontent.com/parvm1102?s=150" width="120" alt="parvm1102"/><br/>
        <strong>parvm1102</strong>
      </a>
      <p>
        <a href="https://github.com/parvm1102" target="_blank">
          <img src="https://img.shields.io/badge/GitHub-100000?style=flat&logo=github&logoColor=white" alt="GitHub"/>
        </a>
        <a href="https://linkedin.com/in/mittal-parv" target="_blank">
          <img src="https://img.shields.io/badge/LinkedIn-0077B5?style=flat&logo=linkedin&logoColor=white" alt="LinkedIn"/>
        </a>
        <a href="mailto:mittal@gitmesh.dev">
          <img src="https://img.shields.io/badge/Email-D14836?style=flat&logo=gmail&logoColor=white" alt="Email"/>
        </a>
      </p>
    </td>
    <td valign="top" width="33%">
      <a href="https://github.com/Ronit-Raj9" target="_blank">
        <img src="https://avatars.githubusercontent.com/Ronit-Raj9?s=150" width="120" alt="Ronit-Raj9"/><br/>
        <strong>Ronit-Raj9</strong>
      </a>
      <p>
        <a href="https://github.com/Ronit-Raj9" target="_blank">
          <img src="https://img.shields.io/badge/GitHub-100000?style=flat&logo=github&logoColor=white" alt="GitHub"/>
        </a>
        <a href="https://www.linkedin.com/in/ronitraj-ai" target="_blank">
          <img src="https://img.shields.io/badge/LinkedIn-0077B5?style=flat&logo=linkedin&logoColor=white" alt="LinkedIn"/>
        </a>
        <a href="mailto:ronii@gitmesh.dev">
          <img src="https://img.shields.io/badge/Email-D14836?style=flat&logo=gmail&logoColor=white" alt="Email"/>
        </a>
      </p>
    </td>
  </tr>
</table>

---

## Connect With the Community

<div align="center">

[![Join Discord](https://img.shields.io/badge/Join%20us%20on-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/xXvYkK3yEp)

</div>

Choose your preferred channel based on your needs:

| Channel | Response Time | Ideal For |
|---------|--------------|-----------|
| [Discord](https://discord.gg/xXvYkK3yEp) | Real-time | Immediate help, community discussions, pair debugging |
| [GitHub Issues](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues) | 1–3 days | Bug reports, feature proposals, technical feedback |
| [Email Support](mailto:gitmesh.oss@gmail.com) | 24–48 hours | Complex technical issues, detailed investigations |
| [Twitter / X](https://x.com/gitmesh_oss) | Variable | Project updates, community highlights, quick mentions |

---

## Project Vitals

<div align="center">

| Metric | Status |
|--------|--------|
| **Commit Activity** | ![Commits](https://img.shields.io/github/commit-activity/t/LF-Decentralized-Trust-labs/gitmesh) |
| **Active Pull Requests** | ![PRs](https://img.shields.io/github/issues-pr/LF-Decentralized-Trust-labs/gitmesh) |
| **Resolved Issues** | ![Issues](https://img.shields.io/github/issues-closed/LF-Decentralized-Trust-labs/gitmesh) |
| **Current Release** | ![Release](https://img.shields.io/github/v/release/LF-Decentralized-Trust-labs/gitmesh) |

</div>

### Growth Trajectory

<div align="center">

<a href="https://www.star-history.com/#LF-Decentralized-Trust-labs/gitmesh&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=LF-Decentralized-Trust-labs/gitmesh&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=LF-Decentralized-Trust-labs/gitmesh&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=LF-Decentralized-Trust-labs/gitmesh&type=Date" width="700" />
  </picture>
</a>

</div>

---

<div align="center">

<a href="https://www.lfdecentralizedtrust.org/">
  <img src="https://www.lfdecentralizedtrust.org/hubfs/LF%20Decentralized%20Trust/lfdt-horizontal-white.png" alt="Supported by the Linux Foundation Decentralized Trust" width="220"/>
</a>

**A Lab under the [Linux Foundation Decentralized Trust](https://www.lfdecentralizedtrust.org/)**

---

*Like wolves navigating vast terrain with purpose and precision, GitMesh helps teams cut through the noise to reach their destination, shipping software that truly matters.*

</div>


















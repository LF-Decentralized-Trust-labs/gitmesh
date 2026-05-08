# GitMesh Agents: Complete Setup Guide

This guide walks you through three methods to get GitMesh Agents running: **Local Development**, **Docker Compose**, and **Docker CLI**.

---

## Prerequisites (All Methods)

- **Git** (to clone the repo)
- **4GB RAM minimum** (8GB recommended)
- **10GB free disk space**

---

## Method 1: Local Development (Recommended for Developers)

Best for hacking on GitMesh itself: reproducible installs, `.env` creation, workspace build.

### Requirements

- **Node.js 20+** ([download](https://nodejs.org))
- **pnpm** is not strictly required upfront: `scripts/setup.mjs` will try **Corepack** (`pnpm@9.15.4`) if `pnpm` is missing

### Recommended: one-command setup (cross-platform)

From the **repository root**, after cloning:

| Platform       | Command        |
|----------------|----------------|
| macOS / Linux  | `./setup.sh`   |
| Windows (PS)   | `.\setup.ps1` |
| Windows (cmd)  | `setup.cmd`    |

These wrap **`node scripts/setup.mjs`** from the repo root (`setup.mjs` resolves paths from its own location), which will:

1. Verify Node 20+
2. Ensure **pnpm** (via Corepack if needed)
3. Copy **`.env.example` → `.env`** when `.env` is missing
4. Optionally start **Docker Postgres** on **localhost:5433** (`--with-docker-db`)
5. Run **`pnpm install --no-frozen-lockfile`** and **`pnpm build`**
6. With **`--start`**, also runs **`pnpm dev`**

Examples:

```bash
node scripts/setup.mjs                              # install + build only
node scripts/setup.mjs --start                      # then start dev automatically
node scripts/setup.mjs --with-docker-db             # also: docker compose -f docker-compose.dev.yml up -d
node scripts/setup.mjs --skip-build                 # deps only (unusual)
```

After setup finishes (without `--start`):

```bash
pnpm dev
```

### Alternative: manual install (advanced)

Equivalent to skipping the wrappers but matching what CI/script expect on a **fresh clone**:

```bash
git clone https://github.com/LF-Decentralized-Trust-labs/gitmesh.git
cd gitmesh
cp .env.example .env                     # optional; omit if .env exists
pnpm install --no-frozen-lockfile       # matches scripts/setup.mjs — avoids lockfile churn on first clone
pnpm build
pnpm dev
```

### Database modes (important)

Choose **one** model for local dev:

| Mode | What to do |
|------|-------------|
| **Embedded PostgreSQL (default)** | Leave **`DATABASE_URL` unset** or commented in `.env`. Data lives under **`~/.gitmesh-agents/instances/default/db/`** (overridable with **`GITMESH_HOME`** / **`GITMESH_INSTANCE_ID`**). No Docker required. |
| **Docker Postgres (`docker-compose.dev.yml`)** | Run **`pnpm db:up`** or **`node scripts/setup.mjs --with-docker-db`**, then set **`DATABASE_URL=postgres://gitmesh:gitmesh@localhost:5433/gitmesh`** in `.env`. Apply migrations after changes: **`DATABASE_URL='postgres://…' pnpm db:migrate`**. |

Port **5433** is **only for this Docker Postgres stack**, not for embedded mode. Detail: **`doc/DATABASE.md`**, **`doc/DEVELOPING.md`**.

### Start development

```bash
pnpm dev
```

- **Default:** API + bundled UI middleware on **`http://localhost:3100`** (**`/api`** and UI same origin).

**Optional operator UX (recommended after scripted setup):**

```bash
pnpm gitmesh-agents run        # onboarding / checks / start helper (wizard)
pnpm gitmesh-agents doctor     # diagnostics; `--repair` for auto-fix attempts
```

**Verification:**

```bash
curl http://localhost:3100/api/health
```

### Development commands

```bash
pnpm dev                       # API + UI (single origin, PORT from .env, default 3100)
pnpm dev:once                  # single run, no file watching
pnpm dev:server                # API only (@gitmesh/server)
pnpm dev:ui                    # Vite UI only → http://localhost:5173 (proxies /api → API PORT, usually 3100)

# Split UI/API: dev:server in one terminal, dev:ui in another.
pnpm db:up                     # Docker Postgres via docker-compose.dev.yml (5433)
pnpm db:down                   # stop compose DB
pnpm -r typecheck              # typecheck all packages
pnpm test:run                  # Vitest suite
pnpm build                     # production build (all packages)
pnpm gitmesh-agents --help     # CLI subcommands (project, agent, audit, …)
```

### Troubleshooting

**Error: `ECONNREFUSED` on PostgreSQL**

- If **`DATABASE_URL`** points at **`localhost:5433`** but Postgres is not running, start **`pnpm db:up`** or clear **`DATABASE_URL`** to use embedded DB.
- If **embedded DB** corrupts / locked: stop **`pnpm dev`**, remove **`~/.gitmesh-agents/instances/default/db`**, restart (data loss for local dev DB only).

**Error: Missing module `@gitmesh/*`**

```bash
pnpm install --no-frozen-lockfile
pnpm build
pnpm dev
```

**Change HTTP port locally**

Set **`PORT`** in **`.env`** (default **`3100`**) — used by **`pnpm dev`**. **`pnpm dev:ui`** expects the API reachable at that **`PORT`** for **`/api` proxy**.

---

## Method 2: Docker Compose (Easiest Docker Setup)

Recommended for one-command Docker deployment.

### Requirements
- Docker Engine 20.10+
- Docker Compose 2.0+

### Steps

1. **Clone the repo:**
   ```bash
   git clone https://github.com/LF-Decentralized-Trust-labs/gitmesh.git
   cd gitmesh
   ```

2. **Start with Compose:**
   ```bash
   docker compose -f docker-compose.quickstart.yml up --build
   ```

   First build takes ~2-3 minutes. Subsequent runs are faster.
   If you previously saw `TS5023: Unknown compiler option '--filter=...@gitmesh/server'`,
   update to the latest `Dockerfile` and rebuild with:
   ```bash
   docker compose -f docker-compose.quickstart.yml build --no-cache
   docker compose -f docker-compose.quickstart.yml up
   ```

3. **Access the application:**
   - Open `http://localhost:3100` in your browser

4. **Verify it's running:**
   ```bash
   curl http://localhost:3100/api/health
   ```

### Optional Configuration

**Change port:**
```bash
GITMESH_PORT=3200 docker compose -f docker-compose.quickstart.yml up --build
```

**Add API keys (Claude + OpenAI):**
```bash
OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=sk-ant-... \
  docker compose -f docker-compose.quickstart.yml up --build
```

**Use external URL (for remote access):**
```bash
GITMESH_PUBLIC_URL=https://agents.example.com \
  docker compose -f docker-compose.quickstart.yml up --build
```

### Data Persistence

- All data stored in: `./data/docker-gitmesh-agents`
- Database, uploads, and secrets are preserved across container restarts
- To reset: `rm -rf ./data/docker-gitmesh-agents`

### Stop the Container

```bash
docker compose -f docker-compose.quickstart.yml down
```

---

## Method 3: Docker CLI (Manual Docker Setup)

For granular control over Docker configuration.

### Requirements
- Docker Engine 20.10+

### Steps

1. **Clone the repo:**
   ```bash
   git clone https://github.com/LF-Decentralized-Trust-labs/gitmesh.git
   cd gitmesh
   ```

2. **Build the image:**
   ```bash
   docker build -t gitmesh-agents-local .
   ```

   First build takes ~2-3 minutes.

3. **Run the container:**
   ```bash
   docker run --name gitmesh-agents \
     -p 3100:3100 \
     -e HOST=0.0.0.0 \
     -e GITMESH_HOME=/gitmesh-agents \
     -v "$(pwd)/data/docker-gitmesh-agents:/gitmesh-agents" \
     gitmesh-agents-local
   ```

4. **Access the application:**
   - Open `http://localhost:3100` in your browser

### Optional: Run with API Keys

```bash
docker run --name gitmesh-agents \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e GITMESH_HOME=/gitmesh-agents \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e OPENAI_API_KEY=sk-... \
  -v "$(pwd)/data/docker-gitmesh-agents:/gitmesh-agents" \
  gitmesh-agents-local
```

### Stop the Container

```bash
docker stop gitmesh-agents
docker rm gitmesh-agents
```

### Clean Up

```bash
# Remove image
docker rmi gitmesh-agents-local

# Remove persisted data
rm -rf ./data/docker-gitmesh-agents
```

---

## Quick Reference: Which Method Should I Use?

| Use Case | Method | Time |
|----------|--------|------|
| Local development / debugging | Local Dev | ~5 min |
| Quick Docker test | Docker Compose | ~3 min |
| Production / CI-CD | Docker CLI or Compose | ~3 min |
| Headless / server only | Docker | N/A |

---

## Post-Setup Configuration

### 1. Create Your First Project

1. Open `http://localhost:3100`
2. Click "New Project"
3. Enter your GitHub repository URL
4. Configure webhooks (GitHub → Settings → Webhooks)

### 2. Add API Keys (Optional)

For agent adapters to work:

**Local Dev:**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
pnpm dev
```

**Docker:**
```bash
# Pass at container startup (see Method 2/3 above)
docker run ... -e ANTHROPIC_API_KEY=... -e OPENAI_API_KEY=... ...
```

### 3. Configure Agents

Create and manage agents from the **operator UI** at **`http://localhost:3100`** once a project exists, or use the **HTTP API**.

**CLI:** the `agent` namespace today supports **`list`**, **`get`**, and **`local-cli`** — not `create`. Inspect help:

```bash
pnpm gitmesh-agents agent --help
```

For **local adapter / API key + playbooks**:

```bash
pnpm gitmesh-agents agent local-cli <agentRef> -P <project-id>
```

---

## Verification Commands

**Health check:**
```bash
curl http://localhost:3100/api/health
```

Expected response (shape may include extra fields):

```json
{"status":"ok"}
```

**Projects / other API:**

- In **`local_trusted`** (default local dev), listing projects may succeed without credentials depending on middleware.
- In **`authenticated`** / **`GITMESH_DEPLOYMENT_MODE=authenticated`** (Docker quickstart builds this pattern), **`/api/projects`** expects a session or bearer token — use the UI or **`pnpm gitmesh-agents project --help`** for client flows rather than naive `curl` alone.

**Quickstart compose smoke check:**
```bash
docker compose -f docker-compose.quickstart.yml up --build -d
curl http://localhost:3100/api/health
docker compose -f docker-compose.quickstart.yml down
```

---

## Logs and Debugging

### Local Dev

```bash
# Watch logs in real-time
pnpm dev

# Check database status
ls -la ~/.gitmesh-agents/instances/default/db
```

### Docker

```bash
# View container logs
docker logs gitmesh-agents

# Tail logs in real-time
docker logs -f gitmesh-agents

# Access container shell
docker exec -it gitmesh-agents bash
```

---

## Common Issues and Fixes

### Issue: Port 3100 Already in Use

**Local Dev:**
```bash
# Optional: kill process listening on PORT (here 3100)
lsof -ti:3100 | xargs kill -9       # Unix

# Prefer setting PORT in .env rather than patching code:
# PORT=3200 (then restart `pnpm dev`)
```

**Docker:**
```bash
# Use different port
docker run -p 3200:3100 ... gitmesh-agents-local
```

### Issue: Out of Disk Space

```bash
# Check Docker disk usage
docker system df

# Clean up unused images/containers
docker system prune -a
```

### Issue: Database Locked

```bash
# Local Dev
rm -rf ~/.gitmesh-agents/instances/default/db
pnpm dev

# Docker
docker stop gitmesh-agents
rm -rf ./data/docker-gitmesh-agents
docker run ... gitmesh-agents-local
```

### Issue: TypeScript Errors During Build

```bash
# Local Dev
pnpm install --no-frozen-lockfile
pnpm -r build
pnpm dev

# Docker
docker build --no-cache -t gitmesh-agents-local .
```

---

## Next Steps

1. **Read the documentation:** [doc/GOAL.md](doc/GOAL.md) and [doc/v1-spec.md](doc/v1-spec.md)
2. **Explore the playbooks:** [playbooks/](playbooks/) directory
3. **Set up your first agent:** See Post-Setup Configuration above
4. **Contributing:** See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md)

---

## Support

- **Issues:** [GitHub Issues](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues)
- **Docs:** [doc/](doc/) directory (engineering) and **`docs/`** ([Mintlify](https://mintlify.com/) site via `pnpm docs:dev`)
- **Developing:** [doc/DEVELOPING.md](doc/DEVELOPING.md)
- **Database:** [doc/DATABASE.md](doc/DATABASE.md)


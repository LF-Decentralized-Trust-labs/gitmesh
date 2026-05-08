# Contributing to GitMesh (Community Edition)

This document describes the minimal rules and workflow for contributing to GitMesh Community Edition.

---

## Commit sign-off (DCO)

All commits **must** be signed off using the Developer Certificate of Origin (DCO).

Create a signed commit:
```bash
git commit -s -m "your commit message"
````

Fix a missing sign-off on the last commit:

```bash
git commit --amend -s
```

Sign multiple commits:

```bash
git rebase --signoff main
# or
git rebase --signoff HEAD~N
```

Pull requests without valid sign-off will be rejected.

---

## Local development

### Prerequisites

* Node.js 20+
* pnpm 9+ (or Corepack-enabled Node)
* Docker + Docker Compose (optional, for quickstart image or local Postgres)
* Git

### Setup

```bash
git clone <your-fork-url>
cd gitmesh
pnpm install --no-frozen-lockfile
pnpm build
pnpm dev
```

Default local URL:

```bash
http://localhost:3100
```

Database mode notes:

- Leave `DATABASE_URL` unset to use embedded PostgreSQL at `~/.gitmesh-agents/instances/default/db/`
- Use `pnpm db:up` only if you want Docker Postgres (`localhost:5433`)

### Docker quickstart (optional)

```bash
docker compose -f docker-compose.quickstart.yml up --build
```

If your build fails with `TS5023` filter-option errors, pull latest and rebuild:

```bash
docker compose -f docker-compose.quickstart.yml build --no-cache
docker compose -f docker-compose.quickstart.yml up
```

---

## Vibe coding (optional)

If you use agent-based or IDE-assisted “vibe coding”, GitMesh provides helper scripts that create local symlinks.

Enable:

```bash
./gitmesh/setup-vibe.sh
```

Disable / clean up:

```bash
./gitmesh/remove-vibe.sh
```

These scripts modify your local workspace only.
Do **not** commit generated symlinks or agent artifacts.
Always review generated code carefully before committing.

---

## Contributing workflow

1. Fork the repository
2. Create a branch:

   ```bash
   git checkout -b type/short-description
   ```
3. Make changes and commit with sign-off:

   ```bash
   git commit -s -m "clear commit message"
   ```
4. Push to your fork:

   ```bash
   git push origin type/short-description
   ```
5. Open a pull request to the upstream repository

---

## Pull request expectations

* Keep PRs small and focused
* Explain what changed and why
* Include testing or reproduction steps when relevant
* Avoid committing local configs, symlinks, or temp files
* Before requesting review, run:
  * `pnpm check:tokens`
  * `pnpm -r typecheck`
  * `pnpm test:run`
  * `pnpm build`

---

## Staying up to date

```bash
git stash
git pull origin main
git stash pop
```

---

## Getting help

* GitHub Issues: bugs, features, technical discussion
* Discord: real-time help and coordination

---

By contributing, you agree that your work is licensed under the project’s Apache 2.0 license and complies with the DCO.
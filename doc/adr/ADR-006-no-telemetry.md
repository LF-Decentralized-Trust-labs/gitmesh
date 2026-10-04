# ADR-006: No telemetry

- **Status:** Accepted
- **Date:** 2026-10-04
- **Pivot references:** `doc/pivot/pivot.md` §1, §8.1, §8.6, §10.1 (principle 1), §15, §16, §17.6; task T2.3

## Context

Task T2.3 asks for a no-telemetry ADR, with adoption measured "via npm
downloads + Action adoption + opt-in `.gitmesh/metrics-optin` ping only" and
a network-spy test in CI as its acceptance criterion. The plan calls it
ADR-005; npm naming took that number first (merge order wins, see the
index), so it lands as ADR-006.

ADR-002 already keeps network calls out of `doctor`, `apply` and `check`, and
says "No telemetry" in one line. This record turns that line into a
decision: what counts as telemetry, what replaces it, what became of the
opt-in ping, and how the rule is tested.

- **The wedge is a trust claim.** `npx gitmesh-cli doctor` is pitched as
  zero-risk on any repository (§1; §8.1: "No network calls, no
  telemetry"), and the README and the doctor quickstart already promise it
  never opens a network connection.
- **The plan's measurement does not need it.** Every gate in §15 reads
  public data: G1 is an npm-download proxy, G2 and G4 count repositories
  found by code search, G3 counts Action adoption (T6.6). §16 rules out
  "anything requiring telemetry" as a KPI.
- **The opt-in ping cannot be built as specified.** Receiving pings needs
  an endpoint GitMesh would run: a server, which §8.6 keeps out of the
  default path (no hosted service before sustained retention, §17.6) and
  ADR-002 keeps out of every CLI feature. And `.gitmesh/` is committed, so a
  `.gitmesh/metrics-optin` file would be the repository's opt-in, not the
  person's: every contributor, every CI runner and anyone auditing that
  repository with `doctor` would send pings, including someone checking a
  repository they do not trust.

## Decision

1. **No telemetry, in any form, in anything GitMesh ships:** the
   `gitmesh-cli` package today, and the GitHub Action (§8.3, T6.2) when it
   lands. Nothing sends data about its own use anywhere: no usage or
   command pings, no crash or error reports, no update or version checks,
   no install-time scripts, no install or machine identifiers, no detached
   sender processes. Not by default, and not as an opt-in.
2. **The `.gitmesh/metrics-optin` ping is dropped** (maintainer decision,
   2026-10-04). Any future telemetry, opt-in or not, needs a new ADR that
   supersedes this one.
3. **Adoption is measured only from public signals that exist without the
   CLI's help:**
   - npm download counts for `gitmesh-cli` (ADR-005): the registry counts
     the tarball fetches `npm` and `npx` make before any GitMesh code runs.
     This is the G1 proxy, and directional only: it includes CI installs
     and mirrors, and misses `npx` runs served from cache.
   - Action adoption: public workflows that use the GitMesh Action, found
     by code search once T6.2 ships; T6.6 publishes the method (the G3
     metric).
   - Public repositories with a committed `.gitmesh/` or a policy pack,
     found by code search (G2, G4).
   - What people choose to tell us: issues, discussions, write-ups.
4. **The only network use left is the one ADR-002 allows:** an explicit
   fetch of content the user names on the command line (`gitmesh skill add
   <source>`, T5.4). It contacts that source only and carries no usage
   data. No other command makes one, and `doctor`, `apply` and `check`
   never do.
5. **Enforcement, in CI on every pull request and push to main, and before
   every publish:**
   - `scripts/network-spy.mjs` is a preload that ends the process with exit
     97 on the first network connection, listening socket, UDP traffic, DNS
     query, subprocess or worker thread, before the call runs. It exits
     rather than throws, because telemetry code swallows its own errors.
   - `scripts/smoke-gitmesh-cli.sh` installs the packed `gitmesh-cli`
     tarball and runs it under the spy: every top-level command
     `gitmesh --help` lists, bare and with `--help`, plus each `doctor`
     output mode. It also fails if any installed package, `gitmesh-cli` or
     a dependency, has an install script. `ci.yml` runs it, and
     `release-cli.yml` runs it before publishing.
   - `scripts/__tests__/network-spy.test.ts` proves every trap still fires,
     so the smoke test cannot pass vacuously.
   - The T1.17 spies keep holding `doctor`'s pipeline to no writes, no
     network and no subprocesses, in process.

## Consequences

- Adoption numbers are coarse, lagging and public, which §16 already
  accepts. There is no per-command usage data; product decisions lean on
  issues, public repositories and the census (T2.4).
- A new command is covered the day it lands: the smoke test reads the
  command list from `gitmesh --help`.
- Dependencies are inside the promise: one that phones home at run time,
  or brings an install script, fails the smoke test and needs a deliberate
  decision.
- The spy is a regression test for honest code, not a sandbox. Code that
  went out of its way to reach Node's internal bindings could get past it;
  review remains the guard against that.
- Out of scope: the frozen legacy commands (`gitmesh legacy`, available in a
  repository checkout only) call the user's own GitMesh Agents server and,
  during setup, the LLM provider the user configures. That is the legacy
  runtime's job, not telemetry, and none of it is in the `gitmesh-cli`
  package.
- A hosted, convenience-only offering after G3 (§17.6) would have to be
  something a user runs on purpose, such as an explicit upload command,
  never background reporting, and it needs its own ADR.

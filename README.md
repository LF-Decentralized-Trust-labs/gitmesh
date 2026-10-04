<div align="center">

<picture>
   <source srcset="public/light_logo.png" media="(prefers-color-scheme: dark)">
   <img src="public/dark_logo.png" alt="GitMesh Logo" width="250">
</picture>

# GitMesh

**Audit and govern every coding agent from your repo.**

[![OpenSource License](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=for-the-badge)](LICENSE)
[![Contributors](https://img.shields.io/github/contributors/LF-Decentralized-Trust-labs/gitmesh.svg?style=for-the-badge&logo=git)](https://github.com/LF-Decentralized-Trust-labs/gitmesh/graphs/contributors)
[![OpenSSF Best Practices](https://img.shields.io/badge/OpenSSF-Silver%20Best%20Practices-silver.svg?style=for-the-badge&logo=opensourceinitiative)](https://www.bestpractices.dev/projects/10972)
<img src="public/mossp.png" alt="Mintlify Open Source Program" width="180" style="border-radius: 12px;" />

[![Join Weekly Dev Call](https://img.shields.io/badge/Join_Weekly_Dev_Call-000000?style=flat&logo=zoom&logoColor=white)](https://zoom-lfx.platform.linuxfoundation.org/meeting/96608771523?password=211b9c60-b73a-4545-8913-75ef933f9365)

</div>

---

<div align="center">
  <!-- Rendered from a real doctor run by scripts/render-doctor-demo.mjs; re-run it when doctor's output changes. -->
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="public/doctor-demo.svg">
    <img src="public/doctor-demo.gif" alt="Terminal recording of npx gitmesh-cli@next doctor on a sample repository: 12 artifacts across nine adapters, no drift to compare, a GM001 error for a plaintext GitHub token in .mcp.json, a GM002 warning for Cursor, score 75/100, exit code 1" width="813">
  </picture>
</div>

## What is GitMesh?

Every coding agent reads its own configuration from your repository, and no two agree on where it lives or what it may do. Instructions get copied between `AGENTS.md`, `CLAUDE.md` and `GEMINI.md` and drift apart. MCP servers are hand-copied into a different file for each agent. Nobody has audited what those agents are permitted to do.

**GitMesh is the agent workspace compiler.** One git-versioned source of truth for instructions, tools and guardrails - `AGENTS.md` plus `.gitmesh/` - audited, compiled to each agent's native config, drift-checked in CI, and enforced through each agent's own mechanisms, which differ from agent to agent (the [coverage matrix](docs/doctor/coverage-matrix.md) will show what each one can enforce). Only the audit ships today: `gitmesh doctor` reads Claude Code, Codex, Cursor, Copilot, Antigravity, OpenCode, Devin, Cline and Roo configuration in one pass. The [status table](#status) lists what comes next.

It is a single CLI (and, later, a GitHub Action). No server, no login, no database, no daemon, and no new instruction format: instructions stay in `AGENTS.md`. The entry command writes nothing.

## Quickstart

Node.js 20 or newer, from any directory inside a git repository:

```bash
npx gitmesh-cli@next doctor
```

The npm package is **`gitmesh-cli`** and the installed binary is **`gitmesh`**; the unscoped npm name `gitmesh` belongs to an unrelated project ([ADR-005](doc/adr/ADR-005-npm-package-naming.md)).

`gitmesh doctor` reads the agent configuration in the repository's working tree across eleven registered adapters in one pass - instruction files, rules, MCP configs, skills, commands, subagents, permission and hook settings - diffs the instruction copies different agents read, and reports risk findings with stable ids. It **never writes a file, never opens a network connection and never runs a subprocess**; the test suite holds every release to that. Pass a directory to audit another checkout: `npx gitmesh-cli@next doctor ../other-repo` scans that directory's git root.

| Flag | Effect |
|---|---|
| `--fail-on <severity>` | severity that makes the run exit `1`: `error`, `warning` (default), `info`, or `none` to never fail |
| `--json` | versioned machine-readable report |
| `--md` | Markdown report for a PR comment or job summary |
| `--user` | also inventory two user-scope files: `~/.claude/CLAUDE.md` and Codex's `config.toml` (in `~/.codex`, or `$CODEX_HOME` when set) |

Exit codes are the CI contract: `0` no finding at or above `--fail-on`, `1` at least one, `2` the run itself failed. No finding can be suppressed in this release, so a gate on the default `warning` stays red until every warning is fixed; `--fail-on error` gates on errors only. Full walkthrough: [docs/doctor/quickstart.md](docs/doctor/quickstart.md).

## What doctor reports

| Id | Severity | Finding |
|---|---|---|
| [GM001](docs/findings/gm001.md) | error | Plaintext secret or token in an MCP config, settings, hooks or config file |
| [GM002](docs/findings/gm002.md) | warning | No deny/ask protection for `.env` files in an agent that can express one |
| [GM003](docs/findings/gm003.md) | error | Bypass-permissions, auto-approve or danger-full-access mode in shared config |
| [GM004](docs/findings/gm004.md) | warning | Skill with executable content and no recognized pin |
| [GM005](docs/findings/gm005.md) | warning | Same MCP server defined with different urls or credentials across tools |
| [GM006](docs/findings/gm006.md) | warning | Generated-looking file hand-edited: broken `gitmesh:managed` markers |
| [GM007](docs/findings/gm007.md) | warning | Instruction file exceeds the 40,000-character threshold |
| [GM008](docs/findings/gm008.md) | info | Orphan config for an agent unseen in repository history |
| [GM009](docs/findings/gm009.md) | warning | Inconsistent local-vs-shared hygiene: `.gitignore` vs committed status |
| [GM010](docs/findings/gm010.md) | warning | `CLAUDE.md` without an `AGENTS.md` bridge, or vice versa |
| [GM011](docs/findings/gm011.md) | warning | Semantic contradictions inside one tool's own config |

GM008 and GM009 are implemented but [silent in this release](docs/findings/overview.md#rules-that-are-silent-today): doctor does not yet read the repository history or the tracked and ignored file status they need.

A GM001 finding names the file, the line and, when there is one, the key of a secret, never any part of its value. Other parts of the report quote configuration text, and a secret with no credential signal around it, such as a password in prose, is printed as written: read [what the report can quote](docs/findings/overview.md#guarantees-shared-by-every-rule) before posting output publicly. Which files doctor reads for each agent is listed in the [coverage matrix](docs/doctor/coverage-matrix.md).

## Status

GitMesh ships in layers. Each one is useful alone, and only what is marked available exists today.

| Command | What it does | Status |
|---|---|---|
| `gitmesh doctor` | audit, cross-tool drift, risk findings - read-only | **available** (`gitmesh-cli@next`) |
| `gitmesh init` / `migrate` | import existing configs (incl. Ruler, rulesync, `.agents/agents.json`) into one source | planned |
| `gitmesh apply` | compile that source into each agent's native files, rewriting only content inside `gitmesh:managed` markers | planned |
| `gitmesh check` | fail CI when generated files drift from source | planned |
| `gitmesh policy` | compile one policy into each agent's own permission model, with a generated coverage report | planned |
| `gitmesh receipt` | signed, offline-verifiable record of workspace state | later |

The plan behind these layers, with its evidence and its kill criteria, is [`doc/pivot/pivot.md`](doc/pivot/pivot.md).

## What GitMesh does not do

- **It does not enforce anything itself.** Doctor reports; each agent's own permission model enforces. GitMesh never claims uniform enforcement across agents, and never calls an instruction a guardrail.
- **It does not scan content for prompt injection, tool poisoning or malicious skills.** That lane belongs to [Snyk Agent Scan and Cisco's scanner](docs/doctor/scanners.md); GitMesh checks structure and hygiene.
- **It does not fight the manager you already use.** Ruler, rulesync, `.agents/agents.json`, symlink managers, `skills-lock.json` and mcp-lock records are detected and labeled `managed by X`; being managed is never itself a finding. Their files are still checked, so a token in `.ruler/mcp.json` is still GM001.
- **It is not the only auditor.** Claude Code's `/doctor`, cc-health-check, agents-lint and AgentLint each audit one tool or one file class well; GitMesh audits the whole multi-vendor workspace.

## Documentation

- [Quickstart](docs/doctor/quickstart.md) - run doctor and read its report
- [Findings GM001-GM011](docs/findings/overview.md) - what each rule checks and how to clear it
- [Coverage matrix](docs/doctor/coverage-matrix.md) - what doctor inventories per agent today
- [Scanners](docs/doctor/scanners.md) - where doctor stops and content-security scanners begin

## Legacy: the GitMesh Agents runtime

The multi-agent orchestration runtime, governed MCP server, PostgreSQL control plane and dashboard that GitMesh shipped before the pivot are still in this repository, in maintenance mode. They are not part of the `gitmesh-cli` package and are not published to npm: run them from a checkout of this repository (`pnpm install`, then `pnpm gitmesh legacy <command>`). Setup is in [doc/SETUP.md](doc/SETUP.md) and [doc/DEVELOPING.md](doc/DEVELOPING.md), with [doc/DATABASE.md](doc/DATABASE.md) and [doc/DOCKER.md](doc/DOCKER.md) for the database and container options; the rest of their documentation moved to [docs/legacy/](docs/legacy/overview.md). Nothing in the new CLI path needs a server or a database.

## Contributing

[![LFX Active Contributors](https://insights.linuxfoundation.org/api/badge/active-contributors?project=lf-decentralized-trust-labs&repos=https://github.com/LF-Decentralized-Trust-labs/gitmesh)](https://insights.linuxfoundation.org/project/lf-decentralized-trust-labs/repository/lf-decentralized-trust-labs-gitmesh)
[![Governance Sync](https://img.shields.io/github/actions/workflow/status/LF-Decentralized-Trust-labs/gitmesh/gov-sync.yml?label=Governance%20Sync)](https://github.com/LF-Decentralized-Trust-labs/gitmesh/actions/workflows/gov-sync.yml)

Adapters are the on-ramp: one directory per agent under [`lib/workspace-adapters/`](lib/workspace-adapters/), one interface, and golden fixtures for every detector.

1. Fork the repository
2. Create a branch: `git checkout -b type/branch-name`
3. Commit with sign-off (DCO is enforced): `git commit -s -m "feat: add ..."`
4. Push the branch: `git push origin type/branch-name`
5. Open a pull request

See the [Contributing Guide](CONTRIBUTING.md) for the full workflow and [AGENTS.md](AGENTS.md) for how coding agents should work in this repository.

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

## License

Licensed under the **Apache License 2.0**. See the [`LICENSE`](LICENSE) file in this repository for the full text.

---

<div align="center">

<a href="https://www.lfdecentralizedtrust.org/">
  <img src="https://www.lfdecentralizedtrust.org/hubfs/LF%20Decentralized%20Trust/lfdt-horizontal-white.png" alt="Supported by the Linux Foundation Decentralized Trust" width="220"/>
</a>

**A Lab under the [Linux Foundation Decentralized Trust](https://www.lfdecentralizedtrust.org/)**

</div>

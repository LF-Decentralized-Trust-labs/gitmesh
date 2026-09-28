# `.gitmesh/agents.yaml` Config Format

GitMesh reads the `.gitmesh/agents.yaml` file from your repository root to configure agents and policies declaratively. This is the recommended configuration method for most projects.

## Location

Place the file at:

```text
your-repo/
├── .gitmesh/
│   └── agents.yaml
├── src/
└── package.json
```

## Schema

```yaml
# .gitmesh/agents.yaml

# Define which AI agents run on your project
agents:
  - name: <string>              # Display name (required)
    role: <agent_role>          # One of the 8 OSS roles (required)
    schedule: <cron_expr>       # Cron schedule for periodic runs (optional)
    triggers: [<event_type>]    # Forge events that trigger runs (optional)
    budget: <number>            # Monthly token budget (required, default: 5000)
    requires_approval: <bool>   # Whether all actions need approval (optional)

# Define governance policies
policies:
  - name: <string>              # Policy name (required)
    actionPattern: <string>     # Action pattern to match (required)
    conditions: <object>        # Additional conditions (optional)
    effect: <policy_effect>     # allow | block | require_approval (required)
    priority: <number>          # Lower = higher priority (optional, default: 100)
```

## Agent Roles

| Role | Description | Typical Schedule |
|------|-------------|-----------------|
| `triage` | Labels, prioritizes, routes, closes duplicates | Hourly |
| `pr_review` | Reviews PRs for style, tests, compliance | On PR opened |
| `docs` | Detects undocumented code, drafts doc PRs | Daily |
| `security` | Monitors CVEs, scans for secrets, flags CI changes | Weekly |
| `community` | Monitors issues/discussions, suggests responses | Every 6 hours |
| `onboarding` | Welcomes first-time contributors | On first PR |
| `release` | Generates changelogs, bumps versions | Manual |
| `general` | General purpose, no specific role | Configurable |

## Trigger Events

| Event | Description |
|-------|-------------|
| `pr_opened` | Pull request opened |
| `pr_merged` | Pull request merged |
| `issue_opened` | Issue created |
| `issue_reopened` | Issue reopened |
| `issue_comment` | Comment on issue |
| `push` | Push to any branch |

## Policy Effects

| Effect | Behavior |
|--------|----------|
| `allow` | Agent proceeds immediately |
| `block` | Agent action is denied |
| `require_approval` | Agent pauses until maintainer approves |

## Examples

### Minimal Config (Solo Maintainer)

```yaml
agents:
  - name: Triage Bot
    role: triage
    schedule: "0 */2 * * *"
    budget: 2000

policies:
  - name: Require approval for all
    actionPattern: "*"
    effect: require_approval
```

### Full Config (JS Library)

```yaml
agents:
  - name: Issue Triage
    role: triage
    schedule: "0 * * * *"
    budget: 5000
    triggers:
      - issue_opened
      - issue_reopened

  - name: PR Review
    role: pr_review
    triggers: [pr_opened]
    budget: 10000

  - name: Docs Sync
    role: docs
    schedule: "0 2 * * *"
    budget: 3000

  - name: Security Agent
    role: security
    schedule: "0 9 * * 1"
    budget: 8000
    requires_approval: true

  - name: Community Agent
    role: community
    schedule: "0 */6 * * *"
    budget: 3000

  - name: Release Agent
    role: release
    budget: 5000
    requires_approval: true

policies:
  - name: Require approval for merge
    actionPattern: merge_pr
    effect: require_approval
    priority: 10

  - name: Block push to main
    actionPattern: push
    conditions:
      targetBranch: [main, master]
    effect: block
    priority: 20

  - name: Allow triage actions
    actionPattern: "close_issue|add_label|assign_issue"
    conditions:
      agentRole: [triage]
    effect: allow
    priority: 50

  - name: Default allow
    actionPattern: "*"
    effect: allow
    priority: 1000
```

## Syncing

When you push changes to `.gitmesh/agents.yaml`, GitMesh automatically syncs the configuration:

1. **New agents** are created with the specified role, schedule, and budget
2. **Removed agents** are flagged for review (not auto-deleted)
3. **Updated agents** have their configuration patched
4. **New policies** are created with the specified rules
5. **Validation errors** are reported as comments on the commit/PR

## Validation

GitMesh validates the YAML on sync:

- Agent names must be non-empty strings
- Roles must be one of the 8 valid OSS roles
- Budgets must be non-negative numbers
- Policy effects must be `allow`, `block`, or `require_approval`
- `actionPattern` must be a non-empty string
- Duplicate roles are flagged as warnings (not errors)

Invalid configurations are rejected with detailed error messages.

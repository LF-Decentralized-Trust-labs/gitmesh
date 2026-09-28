---
title: Writing a Playbook
summary: playbook.md format and best practices
---

Playbooks are reusable instructions that agents can invoke during their heartbeats. They're markdown files that teach agents how to perform specific tasks.

## Playbook Structure

A playbook is a directory containing a `playbook.md` file with YAML frontmatter:

```
playbooks/
└── my-skill/
    ├── playbook.md          # Main playbook document
    └── references/       # Optional supporting files
        └── examples.md
```

## playbook.md Format

```markdown
---
name: my-skill
description: >
  Short description of what this playbook does and when to use it.
  This acts as routing logic - the agent reads this to decide
  whether to load the full playbook content.
---

# My Skill

Detailed instructions for the agent...
```

### Frontmatter Fields

- **name**: unique identifier for the playbook (kebab-case)
- **description**: routing description that tells the agent when to use this playbook. Write it as decision logic, not marketing copy.

## How Playbooks Work at Runtime

1. Agent sees playbook metadata (name + description) in its context
2. Agent decides whether the playbook is relevant to its current task
3. If relevant, agent loads the full playbook.md content
4. Agent follows the instructions in the playbook

This keeps the base prompt small - full playbook content is only loaded on demand.

## Best Practices

- **Write descriptions as routing logic**: include "use when" and "don't use when" guidance
- **Be specific and actionable**: agents should be able to follow playbooks without ambiguity
- **Include code examples**: concrete API calls and command examples are more reliable than prose
- **Keep playbooks focused**: one playbook per concern; don't combine unrelated procedures
- **Reference files sparingly**: put supporting detail in `references/` rather than bloating the main playbook.md

## Playbook Injection

Adapters are responsible for making playbooks discoverable to their agent runtime. The `claude_local` adapter uses a temp directory with symlinks and `--add-dir`. The `codex_local` adapter uses the global playbooks directory. See the [Creating an Adapter](/legacy/adapters/creating-an-adapter) guide for details.

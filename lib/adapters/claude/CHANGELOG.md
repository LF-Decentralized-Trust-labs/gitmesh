# @gitmesh/adapter-claude-local

## 0.4.0

### Patch Changes

- 80c4ea1: Ship the `playbooks/` directory in the packages that read it at runtime.

  Each adapter's `execute.ts` resolves `<package>/playbooks` and symlinks the
  role's playbooks into the agent's config directory, but every one of these
  packages listed `skills` in its `files` array — a leftover from the
  skills-to-playbooks rename. `skills` matched nothing and `playbooks` was not
  listed, so published tarballs contained no playbooks and adapters silently fell
  back to an empty directory. `@gitmesh/adapter-pi-local` listed neither.

  `scripts/release.sh` only copied playbooks into three of the seven packages that
  need them; the package list is now defined once and reused by both the copy and
  the cleanup step, and the publishable-package list is derived from the workspace
  instead of a hand-written list that had drifted.

  Also removes `getSkillsDirectory`, `listAvailableSkills`, and `SkillMetadata`
  from `@gitmesh/adapter-sdk/playbooks`. Nothing imported them, and
  `listAvailableSkills` returned hardcoded metadata pinned to 0.2.7 describing the
  unused `skills/` stub packages, which have been removed. `getPlaybooksForRole`
  and the deprecated `getSkillsForRole` alias are unchanged.

- Updated dependencies [80c4ea1]
  - @gitmesh/adapter-sdk@0.4.0
  - @gitmesh/adapter-shared@0.4.0

## 0.3.0

### Patch Changes

- @gitmesh/adapter-sdk@0.3.0
- @gitmesh/adapter-shared@0.3.0

## 0.2.7

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @gitmesh/adapter-sdk@0.2.7

## 0.2.6

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @gitmesh/adapter-sdk@0.2.6

## 0.2.5

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @gitmesh/adapter-sdk@0.2.5

## 0.2.4

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @gitmesh/adapter-sdk@0.2.4

## 0.2.3

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @gitmesh/adapter-sdk@0.2.3

## 0.2.2

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @gitmesh/adapter-sdk@0.2.2

## 0.2.1

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @gitmesh/adapter-sdk@0.2.1

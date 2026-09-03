import type { RiskRule, RuleFinding } from "./risk.js";

/**
 * GM009 - inconsistent local-vs-shared hygiene: `.gitignore` vs committed
 * status (pivot §8.1 item 3). Every agent family splits personal from
 * shared config (CLAUDE.local.md and `.claude/settings.local.json` vs
 * their project twins; `rulesync.local.jsonc`; `.agents/local.json`), and
 * the split only works when git agrees: a committed local-scope file ships
 * one person's machine state - and possibly their personal paths or hook
 * commands - to every clone, and a gitignored project-scope file silently
 * hides what looks like shared configuration from teammates and CI.
 * Warning tier: hygiene with real leak-adjacent consequences, no active
 * bypass.
 *
 * The engine is pure (no git access), so VCS status is caller-supplied per
 * artifact: `tracked` (committed to the repository) and `ignored` (matched
 * by ignore rules). Both are three-valued - absent means unknown - and the
 * rule fires only on explicit evidence (the GM004/GM008 caller-supplied
 * precedent; the doctor pipeline computes the flags in the T1.16/T1.17
 * lane):
 * - a `scope: "local"` artifact with `tracked: true` - committed personal
 *   state;
 * - a `scope: "project"` artifact with `ignored: true` and
 *   `tracked: false` - shared-looking config invisible to the team.
 * A tracked-but-ignored project file (gitignore drift over an already
 * committed file) sends mixed signals rather than either clear failure and
 * stays out.
 *
 * Repo tiers only (`project` + `local`): user and managed artifacts live
 * outside the repository, where git status has no meaning. Third-party
 * manager artifacts are included: the finding concerns the repo's own git
 * hygiene around a file the manager itself documents as local or shared,
 * and the remediation is a `.gitignore` line, never a write into the
 * manager's territory (ADR-004).
 */
export const gm009: RiskRule = {
  id: "GM009",
  severity: "warning",
  appliesTo: { scopes: ["project", "local"] },
  check: ({ matched }) =>
    matched.flatMap(({ path, scope, tracked, ignored }): RuleFinding[] => {
      if (scope === "local" && tracked === true) {
        return [
          {
            path,
            message: `${path} is a personal local-scope file but is committed; gitignore it so personal machine state stays out of the shared repository.`,
          },
        ];
      }
      if (scope === "project" && ignored === true && tracked === false) {
        return [
          {
            path,
            message: `${path} is shared project configuration but is gitignored; commit it, or move the personal parts to a local-scope variant.`,
          },
        ];
      }
      return [];
    }),
};

import { isRecord, parseJsonc } from "../jsonc.js";
import type { RiskArtifact, RiskInput, RiskRule } from "./risk.js";

/**
 * GM004 - a skill with executable content and no recognized pin (pivot
 * §8.1 item 3, §4.7 Δ3). A skill whose instructions run scripts is supply
 * chain the repo executes; a pin ties it to a reviewed state. Warning tier:
 * the executable signal is heuristic and the remediation is hygiene.
 *
 * Adapter-agnostic over `kind: "skill"` manifests, so every skills dir
 * (`.claude/skills`, `.agents/skills`, `.agent/skills`,
 * `.opencode/{skill,skills}`, `.devin/skills`, `.windsurf/skills`,
 * antigravity plugin bundles) shares one code path. A third-party manager's
 * skill *sources* (`.ruler/skills/**`) are `kind: "source"` and never enter
 * (ADR-004: management is never itself a finding - and per that ADR the
 * mere presence of another manager's lockfile is informational, only read
 * here to honor its pins).
 *
 * Executable content - either signal counts:
 * - the detector stamped `executable: true` (script files inside the skill
 *   directory, T1.12), or
 * - the SKILL.md body (frontmatter stripped) opens a shell code fence or
 *   references a script file. Bare names count for unambiguous script
 *   extensions (`deploy.sh`, `run.py`); `.js`/`.mjs`/`.cjs` require a path
 *   shape (a `/`) so prose like "Node.js" never fires.
 * Docs-only skills never fire (§8.1 says "with executable content").
 *
 * Recognized pins (all three count, §8.1): keys of `skills` in
 * `skills-lock.json` (Vercel skills CLI - any version; an entry's presence
 * is the pin intent), keys of `servers` in `.mcp.lock`
 * (@mcpguards/mcp-lock), and keys of `skills` in `.gitmesh/lock.json`
 * (§10.3; matched by exact path from the full input - no detector emits it
 * until the T5.x lockfile lands, so it is honored the day the doctor
 * pipeline inventories it). A namespaced lock key (`owner/repo/name`) pins
 * the skill its last `/`-segment names. Malformed or unreadable lockfiles
 * contribute no pins; the rule stays total.
 */
export const gm004: RiskRule = {
  id: "GM004",
  severity: "warning",
  appliesTo: { kinds: ["skill", "lockfile"], scopes: ["project"] },
  check: ({ matched, input }) => {
    const pins = recognizedPins(matched, input);
    return matched.flatMap((artifact) => {
      const name = artifact.kind === "skill" ? skillName(artifact.path) : undefined;
      return name !== undefined &&
        artifact.broken !== true &&
        hasExecutableContent(artifact) &&
        !pins.has(name)
        ? [
            {
              path: artifact.path,
              message: `Skill "${name}" has executable content but no recognized pin; pin it in .gitmesh/lock.json, skills-lock.json or .mcp.lock so what it runs is integrity-checked.`,
            },
          ]
        : [];
    });
  },
};

/** The skill's name: the path segment holding its `SKILL.md` manifest. */
function skillName(path: string): string | undefined {
  return /(?:^|\/)([^/]+)\/SKILL\.md$/.exec(path)?.[1];
}

function hasExecutableContent(artifact: RiskArtifact): boolean {
  return (
    artifact.executable === true ||
    (artifact.content !== undefined && bodyLooksExecutable(stripFrontmatter(artifact.content)))
  );
}

/** A fence opener in a shell language - ```bash, ~~~sh, … */
const SHELL_FENCE_RE = /^(?:```|~~~)\s*(?:bash|sh|zsh|shell|console)\b/m;

/**
 * A script-file reference. First alternative: a token (optionally `./`- or
 * path-prefixed) ending in an unambiguous script extension. Second: a
 * `.js`/`.mjs`/`.cjs` token that is path-shaped - see the rule doc.
 */
const SCRIPT_REF_RE =
  /(?:^|[\s`'"(=])\.?\/?[\w.-]+(?:\/[\w.-]+)*\.(?:sh|bash|zsh|py|rb|ps1)\b|(?:^|[\s`'"(=])\.?\/?[\w.-]+(?:\/[\w.-]+)+\.(?:js|mjs|cjs)\b/;

function bodyLooksExecutable(body: string): boolean {
  return SHELL_FENCE_RE.test(body) || SCRIPT_REF_RE.test(body);
}

/** The body after a leading `---` YAML frontmatter block, if one closes. */
function stripFrontmatter(content: string): string {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return content;
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  return end === -1 ? content : lines.slice(end + 1).join("\n");
}

/**
 * The names pinned by every recognized lockfile: matched project-scope
 * `kind: "lockfile"` artifacts by basename, plus `.gitmesh/lock.json`
 * wherever it appears in the full input. Each key pins itself and its last
 * `/`-segment.
 */
function recognizedPins(matched: readonly RiskArtifact[], input: RiskInput): Set<string> {
  const pins = new Set<string>();
  const addKeys = (content: string | undefined, field: string): void => {
    const parsed = content === undefined ? undefined : parseJsonc(content);
    const table = isRecord(parsed) ? parsed[field] : undefined;
    if (isRecord(table)) {
      for (const key of Object.keys(table)) {
        pins.add(key);
        pins.add(key.slice(key.lastIndexOf("/") + 1));
      }
    }
  };
  for (const artifact of matched) {
    if (artifact.kind !== "lockfile") {
      continue;
    }
    const base = artifact.path.slice(artifact.path.lastIndexOf("/") + 1);
    if (base === "skills-lock.json") {
      addKeys(artifact.content, "skills");
    } else if (base === ".mcp.lock") {
      addKeys(artifact.content, "servers");
    }
  }
  for (const artifact of input.artifacts) {
    if (artifact.path === ".gitmesh/lock.json") {
      addKeys(artifact.content, "skills");
    }
  }
  return pins;
}

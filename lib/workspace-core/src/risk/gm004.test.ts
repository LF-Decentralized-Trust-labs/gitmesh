import { describe, expect, it } from "vitest";

import { gm004 } from "./gm004.js";
import { runRiskRules, type RiskArtifact } from "./risk.js";

const skill = (path: string, content?: string, extra: Partial<RiskArtifact> = {}): RiskArtifact => ({
  adapter: "claude-code",
  path,
  kind: "skill",
  scope: "project",
  ...(content === undefined ? {} : { content }),
  ...extra,
});

const lockfile = (path: string, content?: string): RiskArtifact => ({
  adapter: "third-party-managers",
  path,
  kind: "lockfile",
  scope: "project",
  ...(content === undefined ? {} : { content }),
});

const paths = (artifacts: RiskArtifact[]) =>
  runRiskRules({ artifacts }, [gm004]).map((finding) => finding.path);

const DEPLOY = ".claude/skills/deploy/SKILL.md";

describe("GM004", () => {
  it.each([
    ["a backticked script reference", "Run `scripts/deploy.sh staging` to ship."],
    ["a bash fence", "Steps:\n\n```bash\nnpm run build\n```\n"],
    ["a tilde sh fence", "~~~sh\nls\n~~~"],
    ["a ./ script invocation", "Execute ./run.py first."],
    ["a path-shaped js reference", "Then run node tools/build.js before publishing."],
  ])("treats a SKILL.md with %s as executable", (_name, body) => {
    expect(paths([skill(DEPLOY, body)])).toEqual([DEPLOY]);
  });

  it.each([
    ["prose only", "Review the style guide and apply it."],
    ["a non-shell fence", "```json\n{\"a\": 1}\n```"],
    ["a markdown link", "See docs/guide.md for details."],
    ["framework prose", "We use Node.js with D3.js for charts."],
    ["a script named only in frontmatter", "---\nname: deploy\nentry: run.sh\n---\nFollow the checklist."],
  ])("does not treat %s as executable", (_name, body) => {
    expect(paths([skill(DEPLOY, body)])).toEqual([]);
  });

  it("honors the detector's executable stamp without content", () => {
    expect(paths([skill(DEPLOY, undefined, { executable: true })])).toEqual([DEPLOY]);
    expect(paths([skill(DEPLOY, undefined)])).toEqual([]);
  });

  it("emits one warning naming the skill", () => {
    expect(runRiskRules({ artifacts: [skill(DEPLOY, "Run `scripts/deploy.sh`.")] }, [gm004])).toEqual([
      expect.objectContaining({
        ruleId: "GM004",
        severity: "warning",
        path: DEPLOY,
        message: expect.stringContaining('Skill "deploy" has executable content'),
      }),
    ]);
  });

  it.each([
    ["an exact skills-lock key", "skills-lock.json", '{"version": 1, "skills": {"deploy": {}}}'],
    [
      "a namespaced skills-lock key by last segment",
      "skills-lock.json",
      '{"version": 3, "skills": {"vercel-labs/agent-skills/deploy": {"skillFolderHash": "abc"}}}',
    ],
    ["an mcp-lock servers key", ".mcp.lock", '{"lockfileVersion": 1, "servers": {"deploy": {}}}'],
  ])("recognizes %s as a pin", (_name, path, lock) => {
    expect(paths([skill(DEPLOY, "Run `scripts/deploy.sh`."), lockfile(path, lock)])).toEqual([]);
  });

  it("recognizes a .gitmesh/lock.json pin however the caller inventoried it", () => {
    const gitmeshLock: RiskArtifact = {
      adapter: "gitmesh",
      path: ".gitmesh/lock.json",
      kind: "config",
      scope: "project",
      content: '{"skills": {"deploy": {"resolved": "x", "sha256": "y", "pinSource": "gitmesh"}}}',
    };
    expect(paths([skill(DEPLOY, "Run `scripts/deploy.sh`."), gitmeshLock])).toEqual([]);
  });

  it.each([
    ["a pin for a different skill", '{"version": 1, "skills": {"lint": {}}}'],
    ["an empty skills table", '{"version": 1, "skills": {}}'],
    ["a malformed lockfile", "not json"],
    ["a skills value that is not a table", '{"version": 1, "skills": ["deploy"]}'],
  ])("still fires with %s", (_name, lock) => {
    expect(paths([skill(DEPLOY, "Run `scripts/deploy.sh`."), lockfile("skills-lock.json", lock)])).toEqual([
      DEPLOY,
    ]);
  });

  it("a content-less lockfile presence is not a pin and never a finding itself", () => {
    expect(paths([skill(DEPLOY, "Run `scripts/deploy.sh`."), lockfile("skills-lock.json")])).toEqual([
      DEPLOY,
    ]);
    expect(paths([lockfile("skills-lock.json", '{"version": 1, "skills": {}}')])).toEqual([]);
  });

  it("covers every adapter's skills dir through one code path", () => {
    const release = ".agents/skills/release/SKILL.md";
    const ship = ".opencode/skills/ship/SKILL.md";
    expect(
      paths([
        skill(release, "```bash\nmake release\n```", { adapter: "codex" }),
        skill(ship, "Run `scripts/ship.sh`.", { adapter: "opencode" }),
      ]).sort(),
    ).toEqual([release, ship]);
  });

  it("skips broken symlinks, user scope and manager sources", () => {
    expect(
      paths([
        skill(DEPLOY, undefined, { executable: true, broken: true }),
        skill("~/.claude/skills/deploy/SKILL.md", "Run `scripts/deploy.sh`.", { scope: "user" }),
        skill(".ruler/skills/deploy/SKILL.md", "Run `scripts/deploy.sh`.", {
          adapter: "third-party-managers",
          kind: "source",
        }),
      ]),
    ).toEqual([]);
  });
});

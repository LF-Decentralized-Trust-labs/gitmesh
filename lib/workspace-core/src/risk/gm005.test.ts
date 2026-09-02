import { describe, expect, it } from "vitest";

import { gm005 } from "./gm005.js";
import { runRiskRules, type RiskArtifact } from "./risk.js";

const artifact = (
  adapter: string,
  path: string,
  kind: string,
  content?: string,
  scope: RiskArtifact["scope"] = "project",
): RiskArtifact => ({
  adapter,
  path,
  kind,
  scope,
  ...(content === undefined ? {} : { content }),
});

const run = (artifacts: RiskArtifact[]) => runRiskRules({ artifacts }, [gm005]);

const mcpJson = (servers: unknown) => JSON.stringify({ mcpServers: servers });
const claude = (servers: unknown) => artifact("claude-code", ".mcp.json", "mcp-config", mcpJson(servers));
const cursor = (servers: unknown) => artifact("cursor", ".cursor/mcp.json", "mcp-config", mcpJson(servers));

describe("GM005 - url divergence", () => {
  it("flags the same server pointing at different urls in different tools", () => {
    const findings = run([
      claude({ github: { url: "https://mcp.a.example/v1" } }),
      cursor({ github: { url: "https://mcp.b.example/v1" } }),
    ]);
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "GM005",
        severity: "warning",
        message: expect.stringContaining('MCP server "github" is defined with different urls'),
      }),
    ]);
    expect(findings[0]!.message).toContain(".cursor/mcp.json, .mcp.json");
    expect(findings[0]!.path).toBeUndefined();
    expect(findings[0]!.adapter).toBeUndefined();
  });

  it("never leaks the diverging urls into the message (they can embed userinfo)", () => {
    const rendered = JSON.stringify(
      run([
        claude({ github: { url: "https://user:hunter2@mcp.a.example/v1" } }),
        cursor({ github: { url: "https://mcp.b.example/v1" } }),
      ]),
    );
    expect(rendered).not.toContain("hunter2");
    expect(rendered).not.toContain("mcp.a.example");
    expect(rendered).not.toContain("mcp.b.example");
  });

  it("stays silent when every tool agrees", () => {
    const server = { url: "https://mcp.a.example/v1", env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" } };
    expect(run([claude({ github: server }), cursor({ github: server })])).toEqual([]);
  });

  it("stays silent when the servers merely differ in name", () => {
    expect(
      run([
        claude({ github: { url: "https://mcp.a.example/v1" } }),
        cursor({ postgres: { url: "https://mcp.b.example/v1" } }),
      ]),
    ).toEqual([]);
  });

  it("ignores divergence between two files of the same adapter (own layering)", () => {
    expect(
      run([
        claude({ github: { url: "https://mcp.a.example/v1" } }),
        artifact(
          "claude-code",
          "packages/app/.mcp.json",
          "mcp-config",
          mcpJson({ github: { url: "https://mcp.b.example/v1" } }),
        ),
      ]),
    ).toEqual([]);
  });

  it("ignores user-scope definitions (per-machine layering, not repo drift)", () => {
    expect(
      run([
        claude({ github: { url: "https://mcp.a.example/v1" } }),
        artifact(
          "cursor",
          "~/.cursor/mcp.json",
          "mcp-config",
          mcpJson({ github: { url: "https://mcp.b.example/v1" } }),
          "user",
        ),
      ]),
    ).toEqual([]);
  });
});

describe("GM005 - credential divergence", () => {
  it("flags the same env key carrying two values, naming the key and never a value", () => {
    const findings = run([
      claude({ github: { env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" } } }),
      cursor({ github: { env: { GITHUB_TOKEN: "vFakeCredentialValue001" } } }),
    ]);
    expect(findings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('different values for env "GITHUB_TOKEN"'),
      }),
    ]);
    const rendered = JSON.stringify(findings);
    expect(rendered).not.toContain("vFakeCredentialValue001");
    expect(rendered).not.toContain("${GITHUB_TOKEN}");
  });

  it("stays silent when a key is set in one tool and absent in the other", () => {
    expect(
      run([
        claude({ github: { env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" } } }),
        cursor({ github: { env: { GITHUB_HOST: "github.example" } } }),
      ]),
    ).toEqual([]);
  });

  it("compares opencode `environment` against `env`, and headers across spellings", () => {
    const opencode = artifact(
      "opencode",
      "opencode.jsonc",
      "config",
      JSON.stringify({
        mcp: {
          github: {
            type: "remote",
            environment: { GITHUB_TOKEN: "${GH_TOKEN}" },
            headers: { Authorization: "Bearer ${GH_TOKEN}" },
          },
        },
      }),
    );
    const findings = run([
      claude({
        github: {
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
          headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
        },
      }),
      opencode,
    ]);
    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('different values for env "GITHUB_TOKEN"'),
      expect.stringContaining('different values for header "Authorization"'),
    ]);
  });

  it("compares primitive values as strings, so 8080 equals \"8080\"", () => {
    expect(
      run([
        claude({ github: { env: { PORT: 8080 } } }),
        cursor({ github: { env: { PORT: "8080" } } }),
      ]),
    ).toEqual([]);
  });
});

describe("GM005 - definition sources", () => {
  it("reads VS Code's `servers` key only on mcp-config artifacts", () => {
    const servers = JSON.stringify({ servers: { github: { url: "https://mcp.b.example/v1" } } });
    const base = claude({ github: { url: "https://mcp.a.example/v1" } });
    expect(
      run([base, artifact("copilot", ".vscode/mcp.json", "mcp-config", servers)]),
    ).toHaveLength(1);
    expect(run([base, artifact("copilot", ".vscode/settings.json", "settings", servers)])).toEqual(
      [],
    );
  });

  it("reads codex `[mcp_servers.*]` tables: quoted names, url, inline env and sub-tables", () => {
    const toml = [
      'model = "gpt-5.2-codex"',
      "",
      '[mcp_servers."github"]',
      'url = "https://mcp.b.example/v1" # streamable http',
      'env = { GITHUB_HOST = "github.example" }',
      "",
      "[mcp_servers.github.env]",
      'GITHUB_TOKEN = "${GH_TOKEN}"',
      "",
      "[other_table]",
      'url = "https://not-mcp.example"',
    ].join("\n");
    const findings = run([
      claude({
        github: {
          url: "https://mcp.a.example/v1",
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}", GITHUB_HOST: "github.example" },
        },
      }),
      artifact("codex", ".codex/config.toml", "config", toml),
    ]);
    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('different values for env "GITHUB_TOKEN"'),
      expect.stringContaining("different urls"),
    ]);
  });

  it("reads a third-party manager's mcp.json but never its other config files", () => {
    const divergent = mcpJson({ github: { url: "https://mcp.b.example/v1" } });
    const base = claude({ github: { url: "https://mcp.a.example/v1" } });
    expect(
      run([base, artifact("third-party-managers", ".ruler/mcp.json", "config", divergent)]),
    ).toHaveLength(1);
    expect(
      run([base, artifact("third-party-managers", "agentsync.json", "config", divergent)]),
    ).toEqual([]);
  });

  it("stays total on malformed JSON, non-record entries and content-less probes", () => {
    expect(
      run([
        claude({ github: { url: "https://mcp.a.example/v1" } }),
        artifact("cursor", ".cursor/mcp.json", "mcp-config", "not json"),
        artifact("roo", ".roo/mcp.json", "mcp-config", mcpJson({ github: "not a record" })),
        artifact("copilot", ".vscode/mcp.json", "mcp-config"),
      ]),
    ).toEqual([]);
  });
});

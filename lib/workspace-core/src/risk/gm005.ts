import { isRecord, parseJsonc } from "../jsonc.js";
import type { RiskArtifact, RiskRule, RuleFinding } from "./risk.js";

/**
 * GM005 - the same MCP server defined with different credentials or urls
 * across tools (pivot §8.1 item 3). When `github` points at one endpoint
 * in `.mcp.json` and another in `.cursor/mcp.json`, or the same env key
 * carries two values, at least one tool is running against a stale
 * endpoint or credential - the cross-tool rot doctor exists to surface.
 * Warning tier: divergence is drift evidence, not an active bypass
 * (GM003's tier) or a committed secret (GM001's).
 *
 * Definition sources (§4.3), by artifact shape:
 * - an `mcpServers` object - the shape `.mcp.json` (claude-code),
 *   `.cursor/mcp.json`, `.roo/mcp.json`, antigravity `mcp_config.json` and
 *   `.gemini/settings.json`, `.ruler/mcp.json` and `.rulesync/mcp.json{,c}`
 *   all share;
 * - a `servers` object, read only on `kind: "mcp-config"` - VS Code's
 *   `.vscode/mcp.json` (copilot) - so an unrelated `servers` key in some
 *   settings file never counts;
 * - an `mcp` object in `opencode.json{,c}` (entries carry `environment`,
 *   not `env`);
 * - `[mcp_servers.<name>]` tables in `.codex/config.toml`: `url`, inline
 *   `env = { … }` / `http_headers = { … }` and their sub-tables, scanned
 *   line by line per the GM001/GM003 precedent (core carries no TOML
 *   parser).
 *
 * Compared per server name, across *different* adapters only: the `url`,
 * and every shared env/header key (an `env` value in one tool compares
 * against `environment` in another; `headers` against `http_headers`). A
 * key present in one tool and absent in another stays silent - wiring
 * legitimately differs per tool; two *values* for the same key cannot both
 * be current. Same-adapter divergence (a root vs a nested `.mcp.json`) is
 * that tool's own layering, not cross-tool drift, and stays out, as do the
 * user and managed tiers (per-machine layering over the repo; managed
 * probes carry no content anyway).
 *
 * Third-party-manager artifacts enter comparison, but only their MCP
 * source files (`mcp.json{,c}` - a path gate keeps `ruler.toml` or
 * `agentsync.json` out): per the GM001 precedent, a divergence between the
 * manager's source and a tool's config is a property of the repo -
 * typically one manager re-run away from fixed - and per ADR-004 the
 * finding reports the drift and suggests nothing destructive; management
 * itself is never the finding.
 *
 * Findings name the server, the field or key, and the files involved -
 * never a value (hard rule 5), and not the urls either: a url can embed
 * userinfo credentials.
 */
export const gm005: RiskRule = {
  id: "GM005",
  severity: "warning",
  appliesTo: {
    adapters: [
      "antigravity",
      "claude-code",
      "codex",
      "copilot",
      "cursor",
      "opencode",
      "roo",
      "third-party-managers",
    ],
    kinds: ["mcp-config", "config", "settings"],
    scopes: ["project", "local"],
  },
  check: ({ matched }) => compare(matched.flatMap(definitions)),
};

/** One MCP server definition found in one file. */
interface ServerDef {
  server: string;
  adapter: string;
  path: string;
  url?: string;
  /** Credential entries: `env "K"` / `header "K"` → configured value. */
  creds: Map<string, string>;
}

/** The only third-party-manager files that define MCP servers. */
const MANAGER_MCP_RE = /(?:^|\/)mcp\.jsonc?$/;

function definitions(artifact: RiskArtifact): ServerDef[] {
  const { adapter, path, kind, content } = artifact;
  if (content === undefined) {
    return [];
  }
  if (adapter === "third-party-managers" && !MANAGER_MCP_RE.test(path)) {
    return [];
  }
  if (path.endsWith(".toml")) {
    return adapter === "codex" ? codexDefinitions(adapter, path, content) : [];
  }
  const config = parseJsonc(content);
  if (!isRecord(config)) {
    return [];
  }
  const servers = isRecord(config["mcpServers"])
    ? config["mcpServers"]
    : kind === "mcp-config" && isRecord(config["servers"])
      ? config["servers"]
      : adapter === "opencode" && isRecord(config["mcp"])
        ? config["mcp"]
        : undefined;
  if (servers === undefined) {
    return [];
  }
  return Object.entries(servers).flatMap(([server, entry]) =>
    isRecord(entry) ? [jsonDefinition(server, adapter, path, entry)] : [],
  );
}

function jsonDefinition(
  server: string,
  adapter: string,
  path: string,
  entry: Record<string, unknown>,
): ServerDef {
  const creds = new Map<string, string>();
  addCreds(creds, "env", entry["env"]);
  addCreds(creds, "env", entry["environment"]);
  addCreds(creds, "header", entry["headers"]);
  addCreds(creds, "header", entry["http_headers"]);
  const url = typeof entry["url"] === "string" ? entry["url"].trim() : undefined;
  return url === undefined ? { server, adapter, path, creds } : { server, adapter, path, url, creds };
}

/** Copies a table's primitive entries into `creds` under `label "key"`. */
function addCreds(creds: Map<string, string>, label: string, table: unknown): void {
  if (!isRecord(table)) {
    return;
  }
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      creds.set(`${label} "${key}"`, String(value));
    }
  }
}

/** `[mcp_servers.<name>]` / `[mcp_servers.<name>.(env|http_headers)]`. */
const CODEX_TABLE_RE =
  /^\[mcp_servers\.(?:"([^"]+)"|'([^']+)'|([\w-]+))(?:\.(env|http_headers))?\]\s*(?:#.*)?$/;
const CODEX_URL_RE = /^url\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/;
const CODEX_PAIR_RE =
  /^(?:"([^"]+)"|'([^']+)'|([\w.-]+))\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/;
const CODEX_INLINE_RE = /^(env|http_headers)\s*=\s*\{(.*)\}\s*(?:#.*)?$/;
const CODEX_INLINE_PAIR_RE =
  /(?:"([^"]+)"|'([^']+)'|([\w.-]+))\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g;

/**
 * Line scan over `.codex/config.toml` for `[mcp_servers.*]` tables - the
 * GM001/GM003 tolerant-TOML precedent. Understands quoted and bare server
 * names, `url`, inline `env`/`http_headers` tables and their sub-table
 * forms; anything else ends or skips the current table. Never throws.
 */
function codexDefinitions(adapter: string, path: string, content: string): ServerDef[] {
  const defs = new Map<string, ServerDef>();
  let current: ServerDef | undefined;
  let section: "base" | "env" | "http_headers" = "base";
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("[")) {
      const table = CODEX_TABLE_RE.exec(line);
      if (!table) {
        current = undefined;
        continue;
      }
      const server = table[1] ?? table[2] ?? table[3]!;
      current = defs.get(server);
      if (!current) {
        current = { server, adapter, path, creds: new Map() };
        defs.set(server, current);
      }
      section = (table[4] as "env" | "http_headers" | undefined) ?? "base";
      continue;
    }
    if (!current) {
      continue;
    }
    if (section === "base") {
      const url = CODEX_URL_RE.exec(line);
      if (url) {
        current.url = (url[1] ?? url[2]!).trim();
        continue;
      }
      const inline = CODEX_INLINE_RE.exec(line);
      if (inline) {
        const label = inline[1] === "env" ? "env" : "header";
        for (const pair of inline[2]!.matchAll(CODEX_INLINE_PAIR_RE)) {
          current.creds.set(`${label} "${pair[1] ?? pair[2] ?? pair[3]!}"`, pair[4] ?? pair[5] ?? "");
        }
      }
      continue;
    }
    const pair = CODEX_PAIR_RE.exec(line);
    if (pair) {
      const label = section === "env" ? "env" : "header";
      current.creds.set(`${label} "${pair[1] ?? pair[2] ?? pair[3]!}"`, pair[4] ?? pair[5] ?? "");
    }
  }
  return [...defs.values()];
}

/** Cross-adapter comparison of all collected definitions. */
function compare(defs: readonly ServerDef[]): RuleFinding[] {
  const byServer = new Map<string, ServerDef[]>();
  for (const def of defs) {
    const group = byServer.get(def.server);
    if (group) {
      group.push(def);
    } else {
      byServer.set(def.server, [def]);
    }
  }
  const findings: RuleFinding[] = [];
  for (const server of [...byServer.keys()].sort()) {
    const group = byServer.get(server)!;
    const urlPaths = divergentPaths(group, (def) => def.url);
    if (urlPaths.length > 0) {
      findings.push({
        message: `MCP server "${server}" is defined with different urls across tools (${urlPaths.join(", ")}); point every tool at the same endpoint or remove the stale definition.`,
      });
    }
    const labels = new Set(group.flatMap((def) => [...def.creds.keys()]));
    for (const label of [...labels].sort()) {
      const paths = divergentPaths(group, (def) => def.creds.get(label));
      if (paths.length > 0) {
        findings.push({
          message: `MCP server "${server}" is configured with different values for ${label} across tools (${paths.join(", ")}); one of them is stale - settle on one credential and reference it from the environment.`,
        });
      }
    }
  }
  return findings;
}

/**
 * Paths in cross-adapter disagreement over `field`, sorted; empty when
 * every pair of tools that both set the field agrees.
 */
function divergentPaths(
  group: readonly ServerDef[],
  field: (def: ServerDef) => string | undefined,
): string[] {
  const paths = new Set<string>();
  for (const a of group) {
    for (const b of group) {
      if (a.adapter !== b.adapter) {
        const left = field(a);
        const right = field(b);
        if (left !== undefined && right !== undefined && left !== right) {
          paths.add(a.path);
          paths.add(b.path);
        }
      }
    }
  }
  return [...paths].sort();
}

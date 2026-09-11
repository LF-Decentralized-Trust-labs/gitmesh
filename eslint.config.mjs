// @ts-check
import tseslint from "typescript-eslint";

/**
 * Pivot import-boundary lint (task T0.4).
 *
 * AGENTS.md hard rule 1 / pivot.md §9.2, §10.8: nothing in the new
 * workspace-compiler packages may depend on the legacy server runtime or any
 * database code path. `doctor` / `apply` / `check` are pure file operations.
 *
 * Scope is intentionally limited to the pivot packages - the legacy codebase
 * (`server/`, `ui/`, `cli/` legacy commands, old `lib/*`) is frozen and not
 * linted. New per-agent adapter packages must be added to this list as they
 * land (E1+).
 */
const PIVOT_PACKAGE_GLOBS = [
  "lib/workspace-core/**/*.{ts,tsx,mts,cts,js,mjs,cjs}",
  "lib/workspace-adapters/**/*.{ts,tsx,mts,cts,js,mjs,cjs}",
  // The new-product command surface lives inside the legacy `cli` package,
  // whose manifest still carries @gitmesh/server, drizzle-orm and pg - so it
  // needs the boundary rule more than the lib packages do, not less.
  "cli/src/workspace/**/*.{ts,tsx,mts,cts,js,mjs,cjs}",
];

const RESTRICTED_IMPORT_PATTERNS = [
  {
    group: ["@gitmesh/server", "@gitmesh/server/**", "**/server", "**/server/**"],
    message:
      "Pivot boundary (AGENTS.md hard rule 1): workspace-core/adapters must not import the legacy server. doctor/apply/check are pure file operations.",
  },
  {
    group: ["drizzle*", "drizzle*/**"],
    message:
      "Pivot boundary (AGENTS.md hard rule 1): no Drizzle ORM in workspace-core/adapters - the new product has no database.",
  },
  {
    group: [
      "pg",
      "pg/**",
      "pg-*",
      "pg-*/**",
      "postgres",
      "postgres/**",
      "postgres-*",
      "postgres-*/**",
    ],
    message:
      "Pivot boundary (AGENTS.md hard rule 1): no Postgres client libraries in workspace-core/adapters - the new product has no database.",
  },
  {
    // `../**/data` catches relative escapes into lib/data without blocking a
    // package-local `./data/` directory.
    group: ["@gitmesh/data", "@gitmesh/data/**", "../**/data", "../**/data/**"],
    message:
      "Pivot boundary: @gitmesh/data is the legacy Drizzle/Postgres layer and must not leak into workspace-core/adapters.",
  },
];

// no-restricted-imports only sees ESM import/export syntax; these selectors
// close the `require()` escape for the CommonJS file types the glob covers.
const RESTRICTED_REQUIRE_SELECTORS = [
  {
    selector:
      "CallExpression[callee.name='require'] > Literal[value=/^(drizzle|pg$|pg-|postgres|@gitmesh\\u002F(server|data))/]",
    message:
      "Pivot boundary (AGENTS.md hard rule 1): no server, Drizzle, or Postgres requires in workspace-core/adapters.",
  },
  {
    selector:
      "CallExpression[callee.name='require'] > Literal[value=/^(\\.\\.\\u002F)+(.*\\u002F)?(server|data)(\\u002F|$)/]",
    message:
      "Pivot boundary (AGENTS.md hard rule 1): relative requires must not escape into server/ or the legacy data layer.",
  },
];

export default tseslint.config(
  {
    // `data/` holds local Postgres state (unreadable, legacy-only) - never
    // crawl it. Golden fixtures are test data modeling user repos (some will
    // deliberately contain forbidden imports for GM risk rules to detect) -
    // they are compared byte-exactly, never executed, and must not be linted.
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "data/**",
      "lib/workspace-adapters/fixtures/**",
    ],
  },
  {
    files: PIVOT_PACKAGE_GLOBS,
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-restricted-imports": ["error", { patterns: RESTRICTED_IMPORT_PATTERNS }],
      "no-restricted-syntax": ["error", ...RESTRICTED_REQUIRE_SELECTORS],
    },
  },
);

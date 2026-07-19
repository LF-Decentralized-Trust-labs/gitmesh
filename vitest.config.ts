import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "lib/data",
      "lib/workspace-core",
      "lib/workspace-adapters",
      "lib/adapters/opencode",
      "server",
      "ui",
      "cli",
    ],
  },
});

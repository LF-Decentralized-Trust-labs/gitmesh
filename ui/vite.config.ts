import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const rootDir = path.resolve(__dirname, "..");
  const rootEnv = loadEnv(mode, rootDir, "");
  const apiPortRaw = rootEnv.PORT || process.env.PORT || "3100";
  const apiPort = Math.min(65535, Math.max(1, Number(apiPortRaw) || 3100));

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          ws: true,
        },
      },
    },
  };
});

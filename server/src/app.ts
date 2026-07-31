import express, { Router, type Request as ExpressRequest } from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Db } from "@gitmesh/data";
import type { DeploymentExposure, DeploymentMode } from "@gitmesh/core";
import type { StorageService } from "./infra/storage/types.js";
import { httpLogger, errorHandler } from "./infra/middleware/index.js";
import { actorMiddleware } from "./infra/middleware/auth.js";
import { operatorMutationGuard } from "./infra/middleware/operator-mutation-guard.js";
import { privateHostnameGuard, resolvePrivateHostnameAllowSet } from "./infra/middleware/private-hostname-guard.js";
import { healthRoutes } from "./api/health.js";
import { projectRoutes } from "./api/projects.js";
import { forgeWebhookManagementRoutes, forgeWebhookInboundRoutes } from "./api/forge-webhooks.js";
import { policyRoutes } from "./api/policies.js";
import { policyTemplateRoutes } from "./api/policy-templates.js";
import { agentRoutes } from "./api/agents.js";
import { issueRoutes } from "./api/issues.js";
import { goalRoutes } from "./api/goals.js";
import { subprojectRoutes } from "./api/subprojects.js";
import { approvalRoutes } from "./api/approvals.js";
import { secretRoutes } from "./api/secrets.js";
import { costRoutes } from "./api/costs.js";
import { activityRoutes } from "./api/activity.js";
import { dashboardRoutes } from "./api/dashboard.js";
import { sidebarBadgeRoutes } from "./api/sidebar-badges.js";
import { llmRoutes } from "./api/llms.js";
import { assetRoutes } from "./api/assets.js";
import { accessRoutes } from "./api/access.js";
import { heartbeatRoutes } from "./api/heartbeats.js";
import { mcpRoutes } from "./api/mcp-routes.js";
import { acpRoutes } from "./api/acp-routes.js";
import { templateRoutes } from "./api/templates.js";
import { tektonWebhookRoutes } from "./api/tekton-webhooks.js";
import { pullRequestRoutes } from "./api/pull-requests.js";
import { githubRoutes } from "./api/github.js";
import { forgeSyncRoutes } from "./api/forge-webhooks.js";
import { attestationRoutes } from "./api/attestations.js";
import type { BetterAuthSessionResult } from "./infra/auth/better-auth.js";

type UiMode = "none" | "static" | "vite-dev";

export async function createApp(
  db: Db,
  opts: {
    uiMode: UiMode;
    storageService: StorageService;
    deploymentMode: DeploymentMode;
    deploymentExposure: DeploymentExposure;
    allowedHostnames: string[];
    bindHost: string;
    authReady: boolean;
    projectDeletionEnabled: boolean;
    betterAuthHandler?: express.RequestHandler;
    resolveSession?: (req: ExpressRequest) => Promise<BetterAuthSessionResult | null>;
    githubOAuthConfigured?: boolean;
  },
) {
  const app = express();

  // Capture raw body bytes on forge webhook routes so HMAC signature
  // verification (validateGitHubSignature etc.) can hash the exact bytes
  // GitHub signed. Without this, express.json() re-stringifies the parsed
  // body and HMAC checks would fail on whitespace/key-order differences.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        const url = (req as ExpressRequest).originalUrl ?? (req as ExpressRequest).url ?? "";
        if (url.startsWith("/api/forge/webhook/")) {
          (req as ExpressRequest & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
        }
      },
    }),
  );
  app.use(httpLogger);
  const privateHostnameGateEnabled =
    opts.deploymentMode === "authenticated" && opts.deploymentExposure === "private";
  const privateHostnameAllowSet = resolvePrivateHostnameAllowSet({
    allowedHostnames: opts.allowedHostnames,
    bindHost: opts.bindHost,
  });
  app.use(
    privateHostnameGuard({
      enabled: privateHostnameGateEnabled,
      allowedHostnames: opts.allowedHostnames,
      bindHost: opts.bindHost,
    }),
  );
  app.use(
    actorMiddleware(db, {
      deploymentMode: opts.deploymentMode,
      resolveSession: opts.resolveSession,
    }),
  );
  app.get("/api/auth/get-session", (req, res) => {
    if (req.actor.type !== "operator" || !req.actor.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json({
      session: {
        id: `gitmesh-agents:${req.actor.source}:${req.actor.userId}`,
        userId: req.actor.userId,
      },
      user: {
        id: req.actor.userId,
        email: null,
        name: req.actor.source === "local_implicit" ? "Local Maintainer" : null,
      },
      githubOAuthConfigured: opts.githubOAuthConfigured ?? false,
    });
  });
  if (opts.betterAuthHandler) {
    app.all("/api/auth/*authPath", opts.betterAuthHandler);
  }
  app.use(llmRoutes(db));
  app.use("/api", githubRoutes(db));
  app.use("/api", forgeSyncRoutes(db));
  // Attestation endpoints are intentionally public — they expose only
  // signed audit-fact payloads and the project's public key, so anyone
  // with the URL can verify a GitMesh attestation without credentials.
  app.use("/api", attestationRoutes(db));

  // Mount API routes
  const api = Router();
  api.use(operatorMutationGuard());
  api.use(
    "/health",
    healthRoutes(db, {
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      authReady: opts.authReady,
      projectDeletionEnabled: opts.projectDeletionEnabled,
    }),
  );
  api.use("/projects", projectRoutes(db));
  api.use("/projects", forgeWebhookManagementRoutes(db));
  // Inbound forge webhook handlers are stateless entry points that forge
  // providers (GitHub, GitLab, Forgejo) POST to.  They MUST resolve to
  // /api/forge/webhook/<provider> — the same callback URL registered with
  // the forge — so they are mounted at the api root, not under /projects.
  api.use(forgeWebhookInboundRoutes(db));
  api.use("/projects", policyRoutes(db));
  // policyTemplateRoutes mixes top-level (`/policy-templates`) and project-scoped
  // (`/projects/:projectId/policies/install-template`) paths in one router.
  api.use(policyTemplateRoutes(db));
  api.use(agentRoutes(db));
  api.use(assetRoutes(db, opts.storageService));
  // Template registry must mount before root projectRoutes — otherwise `GET /api/templates`
  // is captured by `projectRoutes` `/:projectId` and "templates" is parsed as a UUID.
  api.use(templateRoutes(db));
  api.use(projectRoutes(db));
  api.use(issueRoutes(db, opts.storageService));
  api.use(goalRoutes(db));
  api.use(subprojectRoutes(db));
  api.use(approvalRoutes(db));
  api.use(secretRoutes(db));
  api.use(pullRequestRoutes(db));
  api.use(costRoutes(db));
  api.use(activityRoutes(db));
  api.use(dashboardRoutes(db));
  api.use(heartbeatRoutes(db));
  api.use(sidebarBadgeRoutes(db));
  api.use(mcpRoutes(db));
  api.use(acpRoutes(db));
  api.use(tektonWebhookRoutes(db));
  api.use(
    accessRoutes(db, {
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      bindHost: opts.bindHost,
      allowedHostnames: opts.allowedHostnames,
    }),
  );
  app.use("/api", api);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found" });
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  if (opts.uiMode === "static") {
    // Try published location first (server/ui-dist/), then monorepo dev location (../../ui/dist)
    const candidates = [
      path.resolve(__dirname, "../ui-dist"),
      path.resolve(__dirname, "../../ui/dist"),
    ];
    const uiDist = candidates.find((p) => fs.existsSync(path.join(p, "index.html")));
    if (uiDist) {
      const indexHtml = fs.readFileSync(path.join(uiDist, "index.html"), "utf-8");
      app.use(express.static(uiDist));
      app.get(/.*/, (_req, res) => {
        res.status(200).set("Content-Type", "text/html").end(indexHtml);
      });
    } else {
      console.warn("[gitmesh-agents] UI dist not found; running in API-only mode");
    }
  }

  if (opts.uiMode === "vite-dev") {
    const uiRoot = path.resolve(__dirname, "../../ui");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: uiRoot,
      appType: "spa",
      server: {
        middlewareMode: true,
        allowedHosts: privateHostnameGateEnabled ? Array.from(privateHostnameAllowSet) : undefined,
      },
    });

    app.use(vite.middlewares);
    app.get(/.*/, async (req, res, next) => {
      try {
        const templatePath = path.resolve(uiRoot, "index.html");
        const template = fs.readFileSync(templatePath, "utf-8");
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (err) {
        next(err);
      }
    });
  }

  app.use(errorHandler);

  return app;
}

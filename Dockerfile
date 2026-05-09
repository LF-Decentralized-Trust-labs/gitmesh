FROM node:lts-trixie-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY cli/package.json cli/
COPY server/package.json server/
COPY ui/package.json ui/
COPY lib/core/package.json lib/core/
COPY lib/data/package.json lib/data/
COPY lib/adapter-sdk/package.json lib/adapter-sdk/
COPY lib/adapters/claude/package.json lib/adapters/claude/
COPY lib/adapters/codex/package.json lib/adapters/codex/
COPY lib/adapters/cursor/package.json lib/adapters/cursor/
COPY lib/adapters/gateway/package.json lib/adapters/gateway/
COPY lib/adapters/opencode/package.json lib/adapters/opencode/
COPY lib/adapters/pi/package.json lib/adapters/pi/
COPY lib/adapters/claude-gateway/package.json lib/adapters/claude-gateway/
COPY lib/adapters/_shared/package.json lib/adapters/_shared/

RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app /app
COPY . .
RUN pnpm -r --filter='...@gitmesh/server' --filter='...@gitmesh/agents-ui' build
RUN cp -r ui/dist server/dist/ui-dist
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

FROM base AS production
WORKDIR /app
COPY --from=build /app /app
RUN npm install --global --omit=dev @anthropic-ai/claude-code@latest @openai/codex@latest opencode-ai

RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu locales \
  && sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen \
  && locale-gen \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
  HOME=/gitmesh-agents \
  HOST=0.0.0.0 \
  PORT=3100 \
  SERVE_UI=true \
  GITMESH_HOME=/gitmesh-agents \
  GITMESH_INSTANCE_ID=default \
  GITMESH_CONFIG=/gitmesh-agents/instances/default/config.json \
  GITMESH_DEPLOYMENT_MODE=authenticated \
  GITMESH_DEPLOYMENT_EXPOSURE=private

RUN groupadd --gid 1001 gitmesh \
  && useradd --uid 1001 --gid gitmesh --create-home gitmesh \
  && chown -R gitmesh:gitmesh /app

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

VOLUME ["/gitmesh-agents"]
EXPOSE 3100

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"]

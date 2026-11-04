# Co-op server image. Build from the repo root, because the server imports the agents workspace:
#   docker build -f server/Dockerfile -t coop-server .
# Plain Dockerfile syntax (no BuildKit-only features) so any Docker builder can build it.

FROM node:24-slim AS deps
WORKDIR /app
RUN npm install -g pnpm@10.28.0
# Manifests first: the install layer is reused until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY agents/package.json agents/
COPY checks/package.json checks/
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --prod --filter @coop/server...

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_FILE=/data/agents.json
WORKDIR /app
COPY --from=deps /app ./
COPY agents/tsconfig.json agents/
COPY agents/src agents/src
COPY server/tsconfig.json server/
COPY server/src server/src
# Spawned agents' keys live here; mount a host folder owned by uid 1000 so they survive restarts.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
WORKDIR /app/server
EXPOSE 8787
# tsx runs the TypeScript sources directly, the same way `pnpm --filter @coop/server start` does.
# Node is PID 1 and receives SIGTERM itself, so src/index.ts shuts down cleanly on `docker stop`.
CMD ["node", "--import", "tsx", "src/index.ts"]

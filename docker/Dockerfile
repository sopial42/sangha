# syntax=docker/dockerfile:1
FROM node:24-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY scripts scripts
RUN ./scripts/fetch-plugins.sh /opt/plugins
COPY packages packages
COPY apps apps
RUN npm run build

FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep ca-certificates curl && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @sangha/server && npm cache clean --force
COPY --from=build /src/apps/server/dist apps/server/dist
COPY --from=build /src/apps/web/dist web
COPY --from=build /opt/plugins /opt/sangha/plugins
# bypassPermissions refuses to run as root: Claude runs as the unprivileged node user.
RUN mkdir -p /workspaces /data /home/node/.claude && chown -R node:node /workspaces /data /home/node/.claude
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 \
    SANGHA_WORKSPACES=/workspaces SANGHA_PLUGINS=/opt/sangha/plugins SANGHA_DB=/data/sangha.db SANGHA_WEB_DIST=/app/web
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD curl -fs http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/server/dist/index.js"]

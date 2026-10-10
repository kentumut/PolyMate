ARG NODE_IMAGE=node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.1.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/db/package.json ./packages/db/package.json
RUN pnpm install --frozen-lockfile

# Migrations and database checks only need the root runtime dependency (pg).
# Keeping dev dependencies out makes this image small and quick to export.
FROM ${NODE_IMAGE} AS tooling
WORKDIR /app
RUN npm install --global pnpm@11.1.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/db/package.json ./packages/db/package.json
RUN pnpm install --frozen-lockfile --prod --filter polymate
COPY packages/db/migrations ./packages/db/migrations
COPY tests/fixtures/migrations ./tests/fixtures/migrations
COPY scripts ./scripts
CMD ["node", "scripts/db-check.mjs"]

FROM dependencies AS builder
COPY . .
RUN pnpm build

FROM ${NODE_IMAGE} AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

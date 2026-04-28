# Multistage build for the Munin NestJS backend.
# Build context expected to be the monorepo root.

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

# ─── deps ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY apps/backend/package.json apps/backend/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/mcp-toolkit/package.json packages/mcp-toolkit/
COPY packages/bootstrap/package.json packages/bootstrap/
COPY packages/types/package.json packages/types/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config/package.json packages/eslint-config/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @munin/backend...

# ─── build ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json turbo.json ./
COPY packages/ packages/
COPY apps/backend apps/backend
RUN pnpm --filter @munin/backend... build

# ─── runtime ───────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/backend/dist ./dist
COPY --from=build /repo/apps/backend/package.json ./
COPY --from=build /repo/node_modules ./node_modules
EXPOSE 3001
CMD ["node", "dist/main.js"]

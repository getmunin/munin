# Multistage build for the agent-sidecar.
# Build context expected to be the monorepo root.

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

# ─── deps ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY apps/agent-sidecar/package.json apps/agent-sidecar/
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/sdk/package.json packages/sdk/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config/package.json packages/eslint-config/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @getmunin/agent-sidecar...

# ─── build ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json turbo.json ./
COPY packages/ packages/
COPY apps/agent-sidecar apps/agent-sidecar
RUN pnpm --filter @getmunin/agent-sidecar... build

# ─── runtime ───────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/agent-sidecar/dist ./dist
COPY --from=build /repo/apps/agent-sidecar/package.json ./
COPY --from=build /repo/node_modules ./node_modules
CMD ["node", "dist/main.js"]

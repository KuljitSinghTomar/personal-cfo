# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy manifests first for Docker layer caching
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY lib/ ./lib/
COPY artifacts/ ./artifacts/

RUN pnpm install --frozen-lockfile

# Build API server (esbuild bundles into dist/index.mjs + pino transport workers)
RUN pnpm --filter @workspace/api-server run build

# Build frontend (PORT and BASE_PATH are required by vite.config.ts)
RUN BASE_PATH=/ PORT=3000 NODE_ENV=production \
    pnpm --filter @workspace/family-cfo run build

# ── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:24-alpine AS production

WORKDIR /app

COPY --from=builder /app/artifacts/api-server/dist ./dist
COPY --from=builder /app/artifacts/family-cfo/dist/public ./public

ENV NODE_ENV=production
ENV STATIC_FILES_DIR=/app/public

EXPOSE 3000

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]

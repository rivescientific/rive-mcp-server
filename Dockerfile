# ── Builder stage: install, build deps, build server ──
FROM node:18-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

# Authenticate with GitHub for private repo access
ARG GH_TOKEN
RUN git config --global url."https://${GH_TOKEN}@github.com/".insteadOf "https://github.com/"

COPY package*.json ./

# Cache-bust: change this value when private deps are updated upstream
ARG DEPS_VERSION=2026-03-03c
RUN npm install

# Install build tools globally for building private deps from source
RUN npm install -g tsup typescript esbuild

# ── Build private dependencies (installed as source from GitHub, need compilation) ──

# rive-sdk: build main entry + farnsworth config subpath export (bundled is fine here)
RUN cd node_modules/@rive-scientific/rive-sdk && \
    tsup src/index.ts src/configs/farnsworth/index.ts --format cjs,esm --out-dir dist

# farnsworth-core: transpile each .ts file individually (NOT bundled)
# Bundling with tsup causes export* name collisions between subsystems
# (e.g. developmental/types.ts and methylation/methylation.ts both export createTrait)
# Per-file transpilation preserves module boundaries so Node.js ESM resolves correctly
RUN cd node_modules/@rive/farnsworth-core && \
    mkdir -p dist && \
    find src -name '*.ts' | xargs esbuild --outdir=dist --outbase=src --format=esm --platform=node --target=es2022

# ── Build the MCP server itself ──
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Prune to production deps only (removes devDependencies)
RUN npm prune --omit=dev

# ── Production stage: clean, no tokens, no source ──
FROM node:18-alpine

WORKDIR /app

# Copy production node_modules (includes built private deps with dist/)
COPY --from=builder /app/node_modules ./node_modules

# Copy built MCP server
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]

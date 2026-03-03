# ── Builder stage: install, build deps, build server ──
FROM node:18-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

# Authenticate with GitHub for private repo access
ARG GH_TOKEN
RUN git config --global url."https://${GH_TOKEN}@github.com/".insteadOf "https://github.com/"

COPY package*.json ./
RUN npm install

# ── Build private dependencies (installed as source from GitHub, need compilation) ──

# rive-sdk: uses tsup — build main entry + farnsworth config subpath export
# Skip --dts (type declarations) — rive-mcp-server uses skipLibCheck so only JS needed
RUN cd node_modules/@rive-scientific/rive-sdk && \
    npm install --ignore-scripts 2>/dev/null; \
    npx tsup src/index.ts src/configs/farnsworth/index.ts --format cjs,esm --out-dir dist

# farnsworth-core: uses tsc — remove benchmark/tests dirs first (outside rootDir)
RUN cd node_modules/@rive/farnsworth-core && \
    rm -rf benchmark tests && \
    npm install --ignore-scripts 2>/dev/null; \
    npx tsc

# Clean up nested dev dependencies from private packages (not needed at runtime)
RUN rm -rf node_modules/@rive-scientific/rive-sdk/node_modules && \
    rm -rf node_modules/@rive/farnsworth-core/node_modules

# ── Build the MCP server itself ──
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Prune to production deps only
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

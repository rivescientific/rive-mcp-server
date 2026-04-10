# ── Builder stage: install, build deps, build server ──
FROM node:18-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

# Authenticate with GitHub for private repo access
ARG GH_TOKEN
RUN git config --global url."https://${GH_TOKEN}@github.com/".insteadOf "https://github.com/"

COPY package*.json ./

# Cache-bust: change this value when private deps are updated upstream
ARG DEPS_VERSION=2026-03-05a
RUN npm install

# Install build tools globally for building private deps from source
RUN npm install -g tsup typescript

# ── Build private dependencies (installed as source from GitHub, need compilation) ──

# rive-sdk: build main entry + farnsworth config subpath export
RUN cd node_modules/@rive-scientific/rive-sdk && \
    tsup src/index.ts src/configs/farnsworth/index.ts src/core/coordinator.ts --format cjs,esm --out-dir dist

# farnsworth-core: build custom CJS entry point for MCP server compatibility
RUN cd node_modules/@rive/farnsworth-core && \
    node scripts/generate-mcp-entry.js || \
    node -e " \
      var e = [ \
        'export { createRISC, ThreatType, createDefaultEpigeneticState, createTrait } from \"./immunity/types.js\";', \
        'export { loadSiRNAIntoRISC, scanWithRISC, determineAction, recordFalseAlarm, getFalsePositiveRate } from \"./immunity/risc.js\";', \
        'export { applyPRC2Gating, evaluateGateLift } from \"./developmental/prc2-engine.js\";', \
        'export { createGatingRule, createDevelopmentalStage, DEFAULT_PRC2_CONFIG } from \"./developmental/types.js\";', \
        'export { GatingContext, MethylationContext } from \"./integration/unified-types.js\";', \
      ].join('\\n'); \
      require('fs').writeFileSync('src/rive-mcp-entry.ts', e);"

RUN cd node_modules/@rive/farnsworth-core && \
    tsup src/rive-mcp-entry.ts --format cjs --out-dir dist && \
    node -e " \
      var p=JSON.parse(require('fs').readFileSync('package.json','utf8')); \
      delete p.type; \
      p.main='dist/rive-mcp-entry.cjs'; \
      require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"

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

# ── Builder stage: install, build deps, build server ──
FROM node:18-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

# Authenticate with GitHub for private repo access
ARG GH_TOKEN
RUN git config --global url."https://${GH_TOKEN}@github.com/".insteadOf "https://github.com/"

COPY package*.json ./

# Cache-bust: change this value when private deps are updated upstream
ARG DEPS_VERSION=2026-03-03h
RUN npm install

# Install build tools globally for building private deps from source
RUN npm install -g tsup typescript

# ── Build private dependencies (installed as source from GitHub, need compilation) ──

# rive-sdk: build main entry + farnsworth config subpath export
RUN cd node_modules/@rive-scientific/rive-sdk && \
    tsup src/index.ts src/configs/farnsworth/index.ts --format cjs,esm --out-dir dist

# farnsworth-core: build with CUSTOM ENTRY POINT to avoid export * collisions
# Source inspection shows duplicate exports across modules:
#   - createRISC, ThreatType, createDefaultEpigeneticState, createTrait
#     exist in BOTH immunity/types.ts AND integration/unified-types.ts
#   - GatingContext is in integration/unified-types.ts
#   - createDevelopmentalStage, DEFAULT_PRC2_CONFIG are in developmental/types.ts
# We pick ONE source for each to avoid any collision.
RUN cd node_modules/@rive/farnsworth-core && \
    node -e " \
      require('fs').writeFileSync('src/rive-mcp-entry.ts', [ \
        '// Custom entry — explicit imports from verified source files', \
        '', \
        '// From immunity/types.ts: factory funcs, enums, core types', \
        'export {', \
        '  createRISC,', \
        '  ThreatType,', \
        '  createDefaultEpigeneticState,', \
        '  createTrait,', \
        '} from \"./immunity/types.js\";', \
        '', \
        '// From immunity/risc.ts: scanning/enforcement functions', \
        'export {', \
        '  loadSiRNAIntoRISC,', \
        '  scanWithRISC,', \
        '  determineAction,', \
        '  recordFalseAlarm,', \
        '  getFalsePositiveRate,', \
        '} from \"./immunity/risc.js\";', \
        '', \
        '// From developmental/prc2-engine.ts: PRC2 gating logic', \
        'export {', \
        '  applyPRC2Gating,', \
        '  evaluateGateLift,', \
        '} from \"./developmental/prc2-engine.js\";', \
        '', \
        '// From developmental/types.ts: stage/config creation', \
        'export {', \
        '  createGatingRule,', \
        '  createDevelopmentalStage,', \
        '  DEFAULT_PRC2_CONFIG,', \
        '} from \"./developmental/types.js\";', \
        '', \
        '// From integration/unified-types.ts: enums used as values', \
        'export {', \
        '  GatingContext,', \
        '  MethylationContext,', \
        '} from \"./integration/unified-types.js\";', \
      ].join('\\n')); \
    "

# Build CJS only (no --dts; server has its own declarations.d.ts for types)
RUN cd node_modules/@rive/farnsworth-core && \
    echo '=== Custom entry point ===' && \
    cat src/rive-mcp-entry.ts && \
    tsup src/rive-mcp-entry.ts --format cjs --out-dir dist && \
    node -e " \
      var p=JSON.parse(require('fs').readFileSync('package.json','utf8')); \
      delete p.type; \
      p.main='dist/rive-mcp-entry.cjs'; \
      require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));" && \
    echo '=== farnsworth-core CJS exports ===' && \
    node -e "var m=require('./dist/rive-mcp-entry.cjs'); console.log(Object.keys(m).sort().join(', '));"

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

# ── Builder stage: install, build deps, build server ──
FROM node:18-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

# Authenticate with GitHub for private repo access
ARG GH_TOKEN
RUN git config --global url."https://${GH_TOKEN}@github.com/".insteadOf "https://github.com/"

COPY package*.json ./

# Cache-bust: change this value when private deps are updated upstream
ARG DEPS_VERSION=2026-03-03e
RUN npm install

# Install build tools globally for building private deps from source
RUN npm install -g tsup typescript

# ── Build private dependencies (installed as source from GitHub, need compilation) ──

# rive-sdk: build main entry + farnsworth config subpath export
RUN cd node_modules/@rive-scientific/rive-sdk && \
    tsup src/index.ts src/configs/farnsworth/index.ts --format cjs,esm --out-dir dist

# farnsworth-core: build with CUSTOM ENTRY POINT to avoid export * collisions
# The barrel index.ts re-exports 29 modules, some with conflicting names
# (developmental/types.ts and methylation/methylation.ts both export createTrait).
# Instead, we create a slim entry that explicitly names only what rive-mcp-server needs.
RUN cd node_modules/@rive/farnsworth-core && \
    cat > src/rive-mcp-entry.ts << 'ENTRY' \
// Custom entry point for rive-mcp-server — explicit imports, no export * collisions \
\
// Immunity subsystem \
export { \
  createRISC, \
  loadSiRNAIntoRISC, \
  scanWithRISC, \
  determineAction, \
  recordFalseAlarm, \
  getFalsePositiveRate, \
  ThreatType, \
} from './immunity/risc.js'; \
\
// Developmental subsystem \
export { \
  applyPRC2Gating, \
  evaluateGateLift, \
} from './developmental/prc2-engine.js'; \
\
export { \
  createGatingRule, \
  createDevelopmentalStage, \
  DEFAULT_PRC2_CONFIG, \
  createDefaultEpigeneticState, \
  createTrait, \
} from './developmental/types.js'; \
\
export type { \
  GatingContext, \
  DevelopmentalStage, \
  PRC2Complex, \
  GatingRule, \
  GateLiftResult, \
} from './developmental/types.js'; \
\
// Methylation subsystem (only MethylationContext — values come from developmental) \
export type { \
  MethylationContext, \
  EpigeneticTrait, \
} from './methylation/methylation.js'; \
\
// Immunity types \
export type { \
  RISCComplex, \
  SiRNA, \
  SiRNAScanResult, \
} from './immunity/types.js'; \
\
// State serialization \
export { \
  serializeState, \
  deserializeState, \
} from './integration/unified-types.js'; \
ENTRY
RUN cd node_modules/@rive/farnsworth-core && \
    tsup src/rive-mcp-entry.ts --format cjs --out-dir dist --dts && \
    node -e "\
      var p=JSON.parse(require('fs').readFileSync('package.json','utf8')); \
      delete p.type; \
      p.main='dist/rive-mcp-entry.cjs'; \
      p.types='dist/rive-mcp-entry.d.ts'; \
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

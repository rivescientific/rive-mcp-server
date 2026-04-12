# Rive MCP Server

An MCP (Model Context Protocol) server that wraps the [Rive SDK](https://github.com/rivescientific/rive-sdk) cooperative binding engine and [Farnsworth Core](https://github.com/rivescientific/farnsworth-core) immunity system. Connect it to Claude (or any MCP client) to get document drift detection, semantic search, cross-dataset bridge discovery, and immune-calibrated anomaly detection — all through natural language.

> **For security reviewers:** This server exposes no UI. It is a backend that receives MCP tool calls over HTTPS and returns structured results. All data stays in your Supabase project. See [Security & Data Residency](#security--data-residency) below.

---

## Table of Contents

- [Architecture](#architecture)
- [MCP Tools (Complete Reference)](#mcp-tools-complete-reference)
- [Authentication & Access Control](#authentication--access-control)
- [Data Flow](#data-flow)
- [Security & Data Residency](#security--data-residency)
- [Setup & Installation](#setup--installation)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [Building a Custom Lens](#building-a-custom-lens)
- [Project Structure](#project-structure)
- [Dependencies](#dependencies)
- [License](#license)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Your Claude (Desktop / API / Code)                             │
│  "Compare Q3 vs Q4 handbook for Acme Corp"                      │
└────────────────────────┬────────────────────────────────────────┘
                         │  MCP over HTTPS
                         │  Bearer token auth
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Rive MCP Server (this repo)                                     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Express HTTP Server                                      │   │
│  │  POST /mcp  — MCP StreamableHTTPServerTransport           │   │
│  └────────────────────────┬─────────────────────────────────┘   │
│                            │                                     │
│  ┌────────────────────────┴─────────────────────────────────┐   │
│  │  MCP Tool Layer (10 tools)                                │   │
│  │  search · compare · monitor · bridges · learn             │   │
│  │  immunity · stress · index · get_state · set_state        │   │
│  └────────────────────────┬─────────────────────────────────┘   │
│                            │                                     │
│  ┌─────────────┐  ┌───────┴──────┐  ┌────────────────────┐     │
│  │ Rive Engine  │  │ Farnsworth   │  │ PRC2 Gating        │     │
│  │ Cooperative   │  │ Lenses +     │  │ Agent-level        │     │
│  │ Binding +     │  │ Immunity     │  │ access control     │     │
│  │ Traversal     │  │ (RISC)       │  │ per tool/corpus    │     │
│  └─────────────┘  └──────────────┘  └────────────────────┘     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Data Adapters                                            │   │
│  │  Supabase (primary) · Zoho CRM (optional)                │   │
│  └────────────────────────┬─────────────────────────────────┘   │
└────────────────────────────┼────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Your Supabase Project (you own this)                            │
│  Data, API keys, engine state, Halo alerts                      │
│  We never see your data. It never leaves your project.           │
└─────────────────────────────────────────────────────────────────┘
```

---

## MCP Tools (Complete Reference)

### 1. `rive_search` — Semantic Search

Search across all indexed datasets using cooperative binding.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Natural language search query |
| `datasets` | string[] | No | Limit to specific data sources |
| `max_results` | number | No | Max results (default: 20) |
| `min_affinity` | number | No | Minimum binding affinity threshold (0-1) |

**Returns:** Ranked matches with affinity scores, binding states, source metadata, and cross-dataset bridge annotations.

### 2. `rive_compare` — Document Drift Detection

Compare two documents to detect language shift. This is the core drift detection tool.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text_a` | string | Yes | "Before" document (e.g., Q3 handbook) |
| `text_b` | string | Yes | "After" document (e.g., Q4 handbook) |
| `lens` | string | No | Lens ID to classify drift (e.g., `"payroll"`) |

**Returns:** Emerged terms (new language), vanished terms (removed language), drift magnitude (0-1), and if a lens is specified: category breakdown with percentages, shift profile, and ML-ready feature vector.

**Example:**
```
Emerged: "exempt", "overtime", "threshold", "salary"
Vanished: "hourly", "timesheet"
Drift magnitude: 0.73
Lens (payroll): wage_regulation 85%, benefits 10%, uncategorized 5%
```

### 3. `rive_monitor` — Corpus Anomaly Detection

Check if a new document fits an existing corpus or is anomalous.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `corpus` | string[] | Yes | Array of existing corpus document texts |
| `new_document` | string | Yes | The new document to assess |
| `lens` | string | No | Lens ID for classification |

**Returns:** `isNative` (boolean), `anomalyType` (native / drifted / domain_foreign / corrupted / partial_match), `confidence` (0-1), and lens classification if specified.

### 4. `rive_discover_bridges` — Cross-Dataset Connections

Find shared concepts and connections between different data sources.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `datasets` | string[] | No | Which datasets to bridge (default: all) |
| `min_strength` | number | No | Minimum bridge confidence (0-1) |

**Returns:** Array of bridges, each with source/target dataset, connected fragments, and bridge strength.

### 5. `rive_learn` — Reinforcement Feedback

Feed successful search results back to strengthen bindings. This is how the engine learns from use.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search_result` | object | Yes | A previous search result to reinforce |
| `feedback` | string | No | Optional: `"positive"` or `"negative"` |

**Returns:** Number of bindings updated, whether methylation was applied.

### 6. `rive_assess_immunity` — Query Validation

Check if a query is native to the calibrated corpus or anomalous/adversarial.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | The query to assess |
| `corpus` | string[] | No | Corpus to assess against |

**Returns:** `isNative` (boolean), `s2HitRatio` (S2 binding site activation ratio), `confidence`, threat list with recommended actions.

### 7. `rive_diagnose_stress` — Deep Anomaly Analysis

Detailed inflammasome-style diagnosis of why a query triggered immunity.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | The query to diagnose |
| `corpus` | string[] | No | Corpus context |

**Returns:** `anomalyType`, stress fragment count, suppression signature, diagnostic timing.

### 8. `rive_index_dataset` — Data Ingestion

Trigger indexing of a data source into the engine.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source` | string | Yes | Data source ID to index |
| `force` | boolean | No | Re-index even if already indexed |

**Returns:** Job ID, record count, status.

### 9. `rive_get_state` — Engine State Snapshot

Get the current engine state: mode, indexed corpora, binding sites, methylation cycle, immunity calibration status.

### 10. `rive_set_state` — Restore Engine State

Restore a previously saved engine state. Requires HIGH access level.

---

## Authentication & Access Control

### Bearer Token Auth

Every MCP request must include a valid API key:

```
Authorization: Bearer sk-rive-...
```

API keys are SHA-256 hashed before storage. The plaintext key is never persisted.

### PRC2 Gating (Per-Agent Access Control)

Each API key is scoped to an agent with:

| Field | Purpose |
|-------|---------|
| `agent_id` | Unique agent identifier |
| `access_level` | `HIGH` / `MEDIUM` / `READ_MOSTLY` |
| `allowed_corpora` | Which data sources this agent can query |
| `allowed_tools` | Which MCP tools this agent can call |

**Example:** A "Compliance Reviewer" agent might have `MEDIUM` access, allowed to search and compare but not to re-index or modify state.

### API Key Storage (Supabase)

```sql
-- Table: rive_api_keys
CREATE TABLE rive_api_keys (
  agent_id        TEXT PRIMARY KEY,
  token_hash      TEXT NOT NULL UNIQUE,
  access_level    TEXT NOT NULL,
  allowed_corpora TEXT[],
  allowed_tools   TEXT[],
  created_at      TIMESTAMPTZ DEFAULT now(),
  last_used_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ    -- set to revoke
);
```

---

## Data Flow

```
1. Your documents live in YOUR Supabase tables
2. rive_index_dataset reads from YOUR tables into engine memory
3. All search/compare/monitor operates on in-memory engine state
4. Engine state is persisted back to YOUR Supabase for durability
5. API key auth is checked against YOUR Supabase rive_api_keys table

Nothing leaves your Supabase project.
The MCP server is stateless compute — your data is your data.
```

---

## Security & Data Residency

| Concern | Answer |
|---------|--------|
| **Where is my data stored?** | In your Supabase project. We never see it. |
| **What does the server store?** | Nothing persistent. Engine state is written to your Supabase. |
| **What network ports are exposed?** | One: the HTTP port (default 3000). Only accepts POST to `/mcp`. |
| **What outbound connections does it make?** | Your Supabase URL only. No telemetry, no analytics, no phoning home. |
| **Are API keys stored in plaintext?** | No. SHA-256 hashed before storage. Plaintext is never persisted. |
| **Can agents see each other's data?** | No. PRC2 gating scopes each agent to specific corpora and tools. |
| **Can the server access my Supabase admin?** | It uses the service role key you provide, which bypasses RLS. Access is controlled by PRC2 gating at the MCP layer. For tighter DB-level control, use a dedicated Postgres role with limited grants. |
| **Is source code included in the Docker image?** | No. The production Docker stage copies only compiled JS — no `.ts` source. |
| **What about the private dependencies?** | `rive-sdk` and `farnsworth-core` are proprietary GitHub packages. The MCP server code (this repo) is open for review. |

### Network Surface Area

```
Inbound:
  POST /mcp          — MCP tool calls (requires Bearer token)
  DELETE /mcp        — Session cleanup

Outbound:
  HTTPS → your Supabase URL   — data read/write
  HTTPS → Zoho CRM (optional) — if configured

That's it. No other connections.
```

---

## Setup & Installation

### Prerequisites

- Node.js 18+
- A Supabase project (free tier works)
- npm or yarn

### Install

```bash
git clone https://github.com/rivescientific/rive-mcp-server.git
cd rive-mcp-server
npm install
```

### Build

```bash
npm run build
```

### Run

```bash
# Production
npm start

# Development (auto-reload)
npm run dev
```

### Connect Claude

Add to your Claude MCP config (`claude_desktop_config.json` or equivalent):

```json
{
  "mcpServers": {
    "rive": {
      "url": "https://your-server-url/mcp",
      "headers": {
        "Authorization": "Bearer sk-rive-your-key-here"
      }
    }
  }
}
```

Then ask Claude: *"What tools do you have from rive?"* — it should list all 10.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (not the anon key) |
| `API_KEY_SEED` | Yes | Random seed for API key generation |
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | `production` or `development` |
| `LOG_LEVEL` | No | `info`, `debug`, `warn`, `error` (default: `info`) |
| `ZOHO_CLIENT_ID` | No | Zoho CRM integration (optional) |
| `ZOHO_CLIENT_SECRET` | No | Zoho CRM integration (optional) |
| `ZOHO_REFRESH_TOKEN` | No | Zoho CRM integration (optional) |

See `.env.example` for a template.

---

## Deployment

### Option A: Railway (Recommended)

```bash
railway init
railway env set SUPABASE_URL=https://your-project.supabase.co
railway env set SUPABASE_SERVICE_ROLE_KEY=your-key
railway env set API_KEY_SEED=$(openssl rand -hex 32)
railway deploy
```

The included `railway.json` and `Dockerfile` handle the rest.

### Option B: Docker (Self-Hosted)

```bash
# Build
docker build \
  --build-arg GH_TOKEN=your-github-pat \
  -t rive-mcp-server .

# Run
docker run -d \
  -p 3000:3000 \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=your-key \
  -e API_KEY_SEED=$(openssl rand -hex 32) \
  rive-mcp-server
```

> **Note:** The `GH_TOKEN` build arg is needed to pull private dependencies during build. It is NOT included in the production image — the multi-stage Dockerfile strips it.

### Option C: Direct (Development)

```bash
cp .env.example .env
# Edit .env with your values
npm run dev
```

---

## Configuration

### Data Sources

The server ships with a Supabase data adapter that maps table names to Rive datasets. Table names and ordering columns are configurable via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_TABLE_LEADS` | `leads` | Table for leads/prospects |
| `SUPABASE_TABLE_DEALS` | `deals` | Table for deals/transactions |
| `SUPABASE_TABLE_PROPERTIES` | `properties` | Table for properties/assets |
| `SUPABASE_TABLE_TRANSCRIPTS` | `call_transcripts` | Table for transcripts |
| `SUPABASE_TABLE_EMAILS` | `emails` | Table for emails |

For a **payroll deployment**, you'd override these:

```bash
SUPABASE_TABLE_LEADS=client_handbooks
SUPABASE_TABLE_DEALS=tax_filings
SUPABASE_TABLE_PROPERTIES=benefits_docs
SUPABASE_TABLE_TRANSCRIPTS=compliance_alerts
```

Or better: extend the `SupabaseDataAdapter` with your own domain-specific tables. The adapter pattern is in `src/services/supabase-adapter.ts`.

### Agent Roster (config.yaml — coming soon)

A `config.yaml`-based deployment is planned. For now, agents are provisioned via the `generateApiKey()` function in `src/auth/middleware.ts`. Call it once per agent to create their key:

```typescript
const key = await generateApiKey(
  'payroll_admin',                                    // agent ID
  'HIGH',                                             // access level
  ['*'],                                              // allowed corpora
  ['*']                                               // allowed tools
);
// Returns: sk-rive-abc123...
```

---

## Building a Custom Lens

Lenses classify document drift into domain-specific categories. The engine detects *what changed*; the lens tells you *what kind of change it is*.

This section is a complete guide — your Claude agent can follow these steps to build a lens from scratch.

### What a Lens Is

A lens is a TypeScript object with:
- An **ID** (e.g., `'payroll'`)
- **5-8 categories** (e.g., `tax_compliance`, `wage_regulation`, `benefits`)
- **50-100+ terms per category** — curated from authoritative domain sources

When the engine compares two documents and finds emerged terms, the lens classifies each term into a category. The result is a **shift profile**: "85% wage_regulation, 10% benefits, 5% uncategorized."

### Step 1: Copy the Template

```bash
# In the farnsworth-lenses package
cp -r src/lenses/_template src/lenses/your-domain
```

### Step 2: Define Categories

Choose 5-8 categories that answer: *"When a document's language shifts in this domain, what KIND of shift is it?"*

**Good categories** (payroll example):
- `tax_compliance` — withholding, W-2, FICA, SUTA
- `wage_regulation` — overtime, exempt, minimum wage, FLSA
- `benefits` — COBRA, FMLA, HSA, 401(k)
- `labor_law` — misclassification, AB5, joint employer
- `data_privacy` — SSN, breach notification, PII
- `reporting` — filing deadlines, penalties, amendments
- `workforce` — remote work, gig economy, I-9

**Bad categories:**
- "Is this a payroll document?" (that's a binary classifier, not a lens)
- 20 categories (too many — classification becomes noise)

### Step 3: Curate Terms

For each category, collect terms from authoritative sources. The classification engine uses **5-character prefix matching**: if both the input term and a dictionary term are 5+ characters, and one starts with the first 5 characters of the other, it's a match.

```typescript
tax_compliance: new Set([
  'withholding', 'withhold', 'w2', 'w4', '1099', '941',
  'fica', 'medicare', 'suta', 'futa', 'taxable', 'pretax',
  'posttax', 'deduction', 'garnishment', 'levy', 'exemption',
  // ... 50-100+ terms from IRS Pub 15, state tax codes, etc.
]),
```

**Tips:**
- Lowercase only
- Include singular forms — prefix matching handles plurals
- `'refinanc'` matches `refinance`, `refinancing`, `refinanced`
- Avoid short generic words (`'tax'`, `'pay'`) — they'll match too broadly
- Aim for 80+ terms per category for good coverage

### Step 4: Assemble the Lens

```typescript
import type { LensDefinition } from '../../types.js';

export const YOUR_CATEGORY_NAMES = [
  'category_a',
  'category_b',
  'category_c',
  // ...
] as const;

export type YourCategory = typeof YOUR_CATEGORY_NAMES[number];

export const yourLens: LensDefinition<YourCategory> = {
  id: 'your-domain',
  name: 'Your Domain',
  description: 'Classifies drift in [your domain] documents',
  version: '0.1.0',
  categoryNames: YOUR_CATEGORY_NAMES,
  categories: {
    category_a: new Set(['term1', 'term2', ...]),
    category_b: new Set(['term3', 'term4', ...]),
    // ...
  },
  meta: {
    sources: ['Source 1', 'Source 2'],
    authors: ['Your Name'],
    created: '2026-04-10',
  },
};
```

### Step 5: Export

Add to `src/index.ts`:

```typescript
export { yourLens, YOUR_CATEGORY_NAMES } from './lenses/your-domain/index.js';
export type { YourCategory } from './lenses/your-domain/index.js';
```

Add subpath export to `package.json`:

```json
"./your-domain": {
  "import": "./dist/lenses/your-domain/index.js",
  "types": "./dist/lenses/your-domain/index.d.ts"
}
```

### Step 6: Test

```typescript
import { classifyTerm, classifyTerms, applyLens } from '@farnsworth/lenses';
import { yourLens } from '@farnsworth/lenses/your-domain';

// Single term
const result = classifyTerm('overtime', yourLens);
// → { term: 'overtime', category: 'wage_regulation', matchType: 'exact' }

// Full comparison output
const { profile, features } = applyLens(riveComparisonOutput, yourLens);
// → profile.totalClassified, profile.categoryPercentages, etc.
```

### Step 7: Use in MCP

Pass the lens ID when calling `rive_compare` or `rive_monitor`:

```
rive_compare(text_a: "...", text_b: "...", lens: "your-domain")
```

The MCP server resolves the lens ID to the lens definition and applies it to the engine output.

### Existing Lenses (for reference)

| Lens | Categories | Domain |
|------|-----------|--------|
| `payroll` | 7 | Payroll service compliance (tax, wage, benefits, labor, privacy, reporting, workforce) |
| `financial-risk` | 6 | SEC filings, financial statement drift |
| `pico` | 4 | Clinical research (Population, Intervention, Comparison, Outcome) |
| `code` | 5 | Source code and documentation drift |

---

## Project Structure

```
rive-mcp-server/
├── src/
│   ├── index.ts                 # Express app, MCP transport, main entry
│   ├── types.ts                 # Shared TypeScript types
│   ├── declarations.d.ts        # Type declarations for private deps
│   ├── auth/
│   │   └── middleware.ts        # Bearer token validation, API key generation
│   ├── services/
│   │   ├── rive-engine.ts       # Rive SDK wrapper (search, compare, monitor, immunity)
│   │   ├── farnsworth.ts        # Farnsworth Core wrapper (lenses, RISC, PRC2)
│   │   ├── state-persistence.ts # Engine state save/restore to Supabase
│   │   ├── supabase-adapter.ts  # Supabase → Rive Dataset loader
│   │   └── zoho-adapter.ts      # Zoho CRM → Rive Dataset loader (optional)
│   ├── tools/
│   │   ├── index.ts             # Tool registration (all 10)
│   │   ├── search.ts            # rive_search
│   │   ├── compare.ts           # rive_compare
│   │   ├── monitor.ts           # rive_monitor
│   │   ├── bridges.ts           # rive_discover_bridges
│   │   ├── learn.ts             # rive_learn
│   │   ├── immunity.ts          # rive_assess_immunity + rive_diagnose_stress
│   │   ├── indexing.ts          # rive_index_dataset
│   │   └── state.ts             # rive_get_state + rive_set_state
│   ├── schemas/
│   │   └── index.ts             # Zod validation schemas for tool inputs
│   └── utils/
│       └── logger.ts            # Pino structured logging
├── Dockerfile                   # Multi-stage build (builder + production)
├── railway.json                 # Railway deployment config
├── package.json
├── tsconfig.json
├── .env.example                 # Environment variable template
└── .gitignore
```

---

## Dependencies

### Runtime

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.6.1 | MCP server SDK (StreamableHTTPServerTransport) |
| `@rive-scientific/rive-sdk` | GitHub | Cooperative binding engine (proprietary) |
| `@rive/farnsworth-core` | GitHub | Immunity system + PRC2 gating (proprietary) |
| `@supabase/supabase-js` | ^2.49.1 | Supabase client |
| `express` | ^4.21.2 | HTTP server |
| `zod` | ^3.24.2 | Input validation |
| `pino` / `pino-pretty` | ^9.6.0 | Structured logging |
| `node-cron` | ^3.0.3 | Scheduled tasks |

### Development

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.7.3 | Type checking |
| `tsx` | ^4.19.2 | Dev server with auto-reload |

### Private Dependencies

`rive-sdk` and `farnsworth-core` are proprietary packages hosted on GitHub. They implement the core engine:

- **Rive SDK** — Cooperative binding search engine. Fragments documents, builds binding sites (S0 → S1 → S2), discovers bridges across datasets, measures committed traversal distance.
- **Farnsworth Core** — Immune system layer. RISC scanning, PRC2 epigenetic gating, developmental stages, siRNA failure guides.

The MCP server code (this repo) is open source. The engine packages are available to licensed users.

---

## License

Proprietary — Rive Scientific Inc. Contact alex@rivescientific.com for licensing.

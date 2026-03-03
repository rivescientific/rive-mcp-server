# Rive MCP Server

MCP server wrapping [Rive SDK](https://github.com/abundancere/rive-sdk) + [Farnsworth Core](https://github.com/abundancere/farnsworth-core) for the Abundance RE OpenClaw agent fleet.

## Architecture

```
Mac Mini (OpenClaw)         →  Railway (this server)  →  Supabase
7 Agent Fleet                  MCP over HTTPS              Data Store
Skills + Memory                Bearer Token Auth
                               PRC2 Gating
                               Rive Engine
                               Farnsworth RISC
```

**Security**: Source code stays on Railway. Agents only see MCP tools and results — never code.

## MCP Tools

| Tool | Purpose |
|------|--------|
| `rive_search` | Search across all indexed datasets |
| `rive_discover_bridges` | Find cross-dataset connections |
| `rive_learn` | Feed back search results to improve bindings |
| `rive_assess_immunity` | Detect anomalous/adversarial data |
| `rive_diagnose_stress` | Detailed inflammasome diagnosis |
| `rive_index_dataset` | Trigger data source re-indexing |
| `rive_get_state` | Engine state snapshot |
| `rive_set_state` | Restore engine state |

## Agent Fleet & PRC2 Gating

| Agent | Access Level | Corpora |
|-------|-------------|--------|
| Acquisitions Analyst | HIGH | All |
| Lead Qualifier | MEDIUM | leads, transcripts |
| Deal Underwriter | HIGH | deals, properties, emails, transcripts |
| Dispositions Coordinator | MEDIUM | deals, properties, leads |
| Marketing Agent | READ_MOSTLY | properties, deals |
| Compliance/Docs | HIGH | deals, properties, emails, CRM |
| Mary AI Coordinator | MEDIUM | transcripts, leads |

## Setup

```bash
npm install
npm run build
npm start
```

## Environment Variables

See `.env.example` for required configuration.

## Deploy to Railway

```bash
railway init
railway env set SUPABASE_URL=...
railway env set SUPABASE_SERVICE_ROLE_KEY=...
railway env set API_KEY_SEED=...
railway deploy
```

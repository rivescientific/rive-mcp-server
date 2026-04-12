# Security

## Reporting Vulnerabilities

If you discover a security issue, email alex@rivescientific.com directly. Do not open a public issue.

## Data Residency

- All data is stored in **your** Supabase project
- The MCP server is stateless compute — it holds data in memory only during request processing
- Engine state is persisted to your Supabase between requests
- We have no access to your Supabase project, your data, or your API keys

## Authentication

- Every MCP request requires a `Bearer` token in the `Authorization` header
- Tokens are SHA-256 hashed before storage — plaintext is never persisted
- Tokens can be revoked by setting `revoked_at` on the `rive_api_keys` row
- Each token is scoped to an agent with specific corpus and tool permissions (PRC2 gating)

## Network Surface

| Direction | Endpoint | Purpose |
|-----------|----------|---------|
| **Inbound** | `POST /mcp` | MCP tool calls (authenticated) |
| **Inbound** | `DELETE /mcp` | Session cleanup |
| **Outbound** | Your Supabase URL | Data read/write |
| **Outbound** | Zoho CRM (optional) | Only if configured |

No telemetry. No analytics. No external reporting. No other outbound connections.

## Docker Security

The production Docker image uses a multi-stage build:
1. **Builder stage** — installs dependencies (requires `GH_TOKEN` build arg for private repos)
2. **Production stage** — copies only compiled JavaScript and `node_modules`

The `GH_TOKEN` is **not present** in the production image. No TypeScript source is included.

## Private Dependencies

`@rive-scientific/rive-sdk` and `@rive/farnsworth-core` are proprietary packages on GitHub. The MCP server code (this repo) is fully reviewable. The engine packages are available under license.

## Access Control Model

Access is controlled by **PRC2 gating at the MCP server layer**, not at the database level. Each API key is scoped to an agent with specific `allowed_corpora` and `allowed_tools` permissions, enforced by the server before any database query is made.

> **Note:** The server uses the Supabase **service role key**, which bypasses Row Level Security (RLS) by design. Do not rely on Supabase RLS as a security boundary — the MCP server's PRC2 gating is the access control layer. If you need database-level restrictions, use a dedicated Postgres role with limited grants instead of the service role key.

## Recommendations for Deployment

1. Rotate `API_KEY_SEED` periodically and re-issue agent keys
2. Set `allowed_corpora` and `allowed_tools` per agent — don't give every agent `["*"]`
3. Monitor the `last_used_at` column on `rive_api_keys` for unused or suspicious keys
4. Deploy behind a reverse proxy (Railway does this automatically) for TLS termination
5. For sensitive data (payroll, healthcare): use content templates to strip PII before indexing — see `ContentTemplate` configuration

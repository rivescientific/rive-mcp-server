# Audit

## Audit Trail

The Rive MCP Server provides the following audit-relevant events through structured Pino logging:

| Event | Fields Logged | Sensitivity |
|-------|--------------|-------------|
| Server start | timestamp, version, node version | None |
| Auth success | timestamp, agent_id, access_level | Low |
| Auth failure | timestamp, reason (no agent_id exposed) | Low |
| Revoked token use | timestamp, agent_id | Medium |
| Tool invocation | timestamp, tool_name, agent_id | Low |
| Indexing started | timestamp, corpus_id, source | Low |
| Indexing complete | timestamp, corpus_id, record_count, duration_ms | Low |
| State persisted | timestamp, state_key | None |
| State restored | timestamp, state_key | None |

## What Is NOT in the Audit Trail

- Document content (never logged)
- Search queries (not logged at `info` level)
- PII fields (stripped before processing when templates are configured)
- API key plaintext (never persisted anywhere)

## SOC2 Mapping (Planned)

| SOC2 Common Criteria | Status | Notes |
|---------------------|--------|-------|
| CC6.1 — Logical access | ✅ Implemented | Bearer token auth, PRC2 per-agent gating |
| CC6.2 — Auth mechanisms | ✅ Implemented | SHA-256 hashed keys, revocation support |
| CC6.3 — Access removal | ✅ Implemented | `revoked_at` column, immediate effect |
| CC7.1 — Monitoring | 🟡 Partial | Structured logging; persistent audit store TBD |
| CC7.2 — Anomaly detection | 🟡 Partial | Immunity system detects data anomalies; operational anomaly detection TBD |
| CC8.1 — Change management | 🔴 Planned | Git history; formal change log TBD |

## Compliance Checklist for Security Reviewers

- [ ] API keys are SHA-256 hashed before storage
- [ ] Service role key usage is documented (bypasses RLS — see SECURITY.md)
- [ ] PRC2 gating enforces per-agent corpus and tool access
- [ ] Content templates strip PII before tokenization
- [ ] No outbound connections except configured data stores
- [ ] Docker production image contains no source code or build tokens
- [ ] Structured logging captures auth and tool invocation events
- [ ] Log output goes to stdout only (no file writes by the server)

## Next Steps

- Persistent audit log store (Azure Log Analytics / Supabase audit table)
- Formal change log with versioned releases
- Automated compliance test suite
- EULA / data processing agreement template

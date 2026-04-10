# Data Retention

## Engine State

| Data | Storage | Retention |
|------|---------|-----------|
| Binding sites | In-memory + persisted to data store | Retained until explicit reset or re-index |
| Methylation state | In-memory + persisted to data store | Retained across server restarts |
| Immunity calibration | In-memory + persisted to data store | Retained until re-calibration |

## API Keys

| Data | Storage | Retention |
|------|---------|-----------|
| Token hashes | `rive_api_keys` table | Until explicitly revoked (`revoked_at` set) |
| `last_used_at` | `rive_api_keys` table | Updated on each use |

## Indexed Data

Source data is loaded from your data store into engine memory during indexing. The engine holds fragment representations (not raw content) in memory. Raw content is not persisted by the MCP server — it stays in your source tables.

## Logs

Log retention is determined by your deployment platform. The MCP server writes to stdout only. See [LOGGING.md](./LOGGING.md).

## Content Templates (PII)

When content templates are configured, PII fields are stripped **before** tokenization. Stripped fields are never stored in engine memory, never included in search results, and never logged.

## Recommendations

1. Set a key rotation schedule (e.g., 90 days) and revoke old keys
2. Re-index corpora periodically to reflect source data changes
3. Configure log retention in your deployment platform to meet your compliance requirements
4. Audit `rive_api_keys.last_used_at` monthly for unused keys

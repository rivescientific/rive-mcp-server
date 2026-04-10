# Logging

## Log Framework

Rive MCP Server uses [Pino](https://github.com/pinojs/pino) for structured JSON logging.

## Log Levels

| Level | When |
|-------|------|
| `error` | Unrecoverable failures, auth failures |
| `warn` | Revoked token usage, missing columns, fallback behavior |
| `info` | Server start/stop, tool registration, indexing events, auth success |
| `debug` | Engine internals, binding state changes, per-request details |

Configure via `LOG_LEVEL` environment variable (default: `info`).

## What Is Logged

- Server lifecycle events (start, stop, initialization)
- MCP tool invocations (tool name, agent ID, timestamp)
- Auth events (token validation success/failure, revoked token usage)
- Indexing operations (source, record count, duration)
- Engine state changes (mode, methylation cycles)

## What Is NOT Logged

- Document content (never logged)
- Search queries (not logged by default; enable `debug` level at your own risk)
- API key plaintext (never — only hashes are stored)
- PII fields (stripped before any processing when content templates are configured)

## Log Rotation

Pino outputs to stdout. Use your deployment platform's log management:
- **Railway:** Built-in log viewer with retention
- **Docker:** `docker logs` or pipe to a log aggregator
- **Azure:** Forward stdout to Azure Monitor / Log Analytics

## Compliance Notes

For SOC2 / audit requirements, pipe Pino output to a persistent log store with retention policies. A sample Pino transport for Azure Log Analytics is planned.

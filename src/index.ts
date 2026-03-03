import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createChildLogger } from './utils/logger.js';
import { initAuth, validateToken, extractBearerToken } from './auth/middleware.js';
import { RiveEngineService } from './services/rive-engine.js';
import { FarnsworthService } from './services/farnsworth.js';
import { StatePersistence } from './services/state-persistence.js';
import { SupabaseDataAdapter } from './services/supabase-adapter.js';
import { ZohoDataAdapter } from './services/zoho-adapter.js';
import { registerAllTools } from './tools/index.js';
import type { AgentCredentials } from './types.js';

const log = createChildLogger('server');

// ── Services ──

const persistence = new StatePersistence();
const engineService = new RiveEngineService(persistence);
const farnsworthService = new FarnsworthService();
const supabaseAdapter = new SupabaseDataAdapter();
const zohoAdapter = new ZohoDataAdapter();

// ── Per-request credentials ──
// The MCP SDK doesn't natively support per-request auth,
// so we use a request-scoped store keyed by a unique session ID.

const requestCredentials = new Map<string, AgentCredentials>();

function getCredentials(): AgentCredentials | null {
  // In a streaming MCP session, we use the session transport's internal state.
  // For stateless HTTP, we use the last authenticated credentials.
  // This is a simplification — production should use AsyncLocalStorage.
  const entries = Array.from(requestCredentials.entries());
  if (entries.length === 0) return null;
  // Return most recent
  return entries[entries.length - 1][1];
}

// ── Main ──

async function main() {
  log.info('Starting Rive MCP Server');

  // Initialize auth
  initAuth();

  // Initialize Rive engine
  await engineService.initialize();
  log.info('Rive engine initialized');

  // Initialize Zoho adapter
  await zohoAdapter.connect();

  // Create MCP server
  const mcpServer = new McpServer(
    {
      name: 'rive-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register all tools
  registerAllTools(
    mcpServer,
    engineService,
    farnsworthService,
    persistence,
    supabaseAdapter,
    zohoAdapter,
    getCredentials
  );

  // ── Express HTTP Server ──

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'rive-mcp-server',
      uptime: engineService.getUptime(),
      mode: engineService.getMode(),
    });
  });

  // MCP endpoint with authentication
  app.post('/mcp', async (req, res) => {
    // Authenticate
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({ error: 'Missing Bearer token in Authorization header' });
      return;
    }

    const credentials = await validateToken(token);
    if (!credentials) {
      res.status(403).json({ error: 'Invalid or revoked API key' });
      return;
    }

    // Store credentials for this request
    const requestId = `${Date.now()}-${Math.random()}`;
    requestCredentials.set(requestId, credentials);

    log.info(
      { agentId: credentials.agentId, accessLevel: credentials.accessLevel },
      'Authenticated MCP request'
    );

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      // Clean up on close
      res.on('close', () => {
        requestCredentials.delete(requestId);
        transport.close();
      });

      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: any) {
      requestCredentials.delete(requestId);
      log.error({ err, agentId: credentials.agentId }, 'MCP request failed');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  // MCP GET/DELETE for session management
  app.get('/mcp', async (req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use POST for MCP requests.' });
  });

  // ── Start Server ──

  const port = parseInt(process.env.PORT || '3000', 10);
  app.listen(port, '0.0.0.0', () => {
    log.info({ port }, `Rive MCP Server listening on port ${port}`);
    log.info('Tools registered: rive_search, rive_discover_bridges, rive_learn, rive_assess_immunity, rive_diagnose_stress, rive_index_dataset, rive_get_state, rive_set_state');
  });

  // ── Scheduled Indexing ──
  // In production, use node-cron here for periodic re-indexing.
  // For now, indexing is triggered via the rive_index_dataset tool.

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    try {
      const state = engineService.getState();
      await persistence.saveState(state, { reason: 'shutdown' });
      log.info('State saved before shutdown');
    } catch (err) {
      log.error({ err }, 'Failed to save state on shutdown');
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.fatal({ err }, 'Failed to start server');
  process.exit(1);
});

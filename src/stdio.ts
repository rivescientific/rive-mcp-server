/**
 * stdio transport entry point for local/offline testing.
 *
 * Usage:
 *   npx tsx src/stdio.ts
 *   node dist/stdio.js
 *
 * This runs the MCP server over stdin/stdout instead of HTTP,
 * so no network infrastructure is needed. Claude Desktop can
 * connect to it directly via the stdio transport config:
 *
 *   {
 *     "mcpServers": {
 *       "rive": {
 *         "command": "node",
 *         "args": ["dist/stdio.js"],
 *         "cwd": "/path/to/rive-mcp-server"
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RiveEngineService } from './services/rive-engine.js';
import { FarnsworthService } from './services/farnsworth.js';
import { StatePersistence } from './services/state-persistence.js';
import { SupabaseDataAdapter } from './services/supabase-adapter.js';
import { ZohoDataAdapter } from './services/zoho-adapter.js';
import { registerAllTools } from './tools/index.js';
import { createChildLogger } from './utils/logger.js';
import type { AgentCredentials } from './types.js';

const log = createChildLogger('stdio');

async function main() {
  log.info('Starting Rive MCP Server (stdio transport)');

  const persistence = new StatePersistence();
  const engineService = new RiveEngineService(persistence);
  const farnsworthService = new FarnsworthService();
  const supabaseAdapter = new SupabaseDataAdapter();
  const zohoAdapter = new ZohoDataAdapter();

  await engineService.initialize();
  log.info('Rive engine initialized');

  // In stdio mode, use a default admin credential (single-user local mode)
  const localCredentials: AgentCredentials = {
    agentId: 'local-admin',
    accessLevel: 'HIGH',
    allowedCorpora: ['*'],
    allowedTools: ['*'],
  };

  const getCredentials = (): AgentCredentials => localCredentials;

  const server = new McpServer({
    name: 'rive-mcp-server',
    version: '1.0.0',
  });

  registerAllTools(
    server,
    engineService,
    farnsworthService,
    persistence,
    supabaseAdapter,
    zohoAdapter,
    getCredentials,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info('Rive MCP Server running on stdio');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RiveEngineService } from '../services/rive-engine.js';
import type { FarnsworthService } from '../services/farnsworth.js';
import type { StatePersistence } from '../services/state-persistence.js';
import type { SupabaseDataAdapter } from '../services/supabase-adapter.js';
import type { ZohoDataAdapter } from '../services/zoho-adapter.js';
import type { AgentCredentials } from '../types.js';

import { registerSearchTool } from './search.js';
import { registerBridgesTool } from './bridges.js';
import { registerLearnTool } from './learn.js';
import { registerImmunityTools } from './immunity.js';
import { registerIndexingTool } from './indexing.js';
import { registerStateTools } from './state.js';
import { registerCompareTool } from './compare.js';
import { registerMonitorTool } from './monitor.js';

import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('tools');

export function registerAllTools(
  server: McpServer,
  engineService: RiveEngineService,
  farnsworthService: FarnsworthService,
  persistence: StatePersistence,
  supabaseAdapter: SupabaseDataAdapter,
  zohoAdapter: ZohoDataAdapter,
  getCredentials: () => AgentCredentials | null
) {
  log.info('Registering all MCP tools');

  // 1. rive_search
  registerSearchTool(server, engineService, farnsworthService, getCredentials);

  // 2. rive_discover_bridges
  registerBridgesTool(server, engineService, farnsworthService, getCredentials);

  // 3. rive_learn
  registerLearnTool(server, engineService, farnsworthService, persistence, getCredentials);

  // 4 & 5. rive_assess_immunity + rive_diagnose_stress
  registerImmunityTools(server, engineService, farnsworthService, getCredentials);

  // 6. rive_index_dataset
  registerIndexingTool(
    server,
    engineService,
    farnsworthService,
    persistence,
    supabaseAdapter,
    zohoAdapter,
    getCredentials
  );

  // 7 & 8. rive_get_state + rive_set_state
  registerStateTools(server, engineService, farnsworthService, getCredentials);

  // 9. rive_compare (coordinator: temporal drift between two documents)
  registerCompareTool(server, engineService, farnsworthService, getCredentials);

  // 10. rive_monitor (coordinator: immunity-based corpus monitoring)
  registerMonitorTool(server, engineService, farnsworthService, getCredentials);

  log.info('All 10 MCP tools registered');
}

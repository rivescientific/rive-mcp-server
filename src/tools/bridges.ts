import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BridgesInputSchema } from '../schemas/index.js';
import type { RiveEngineService } from '../services/rive-engine.js';
import type { FarnsworthService } from '../services/farnsworth.js';
import type { AgentCredentials, BridgeDiscoveryResult } from '../types.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('tool:bridges');

export function registerBridgesTool(
  server: McpServer,
  engineService: RiveEngineService,
  farnsworthService: FarnsworthService,
  getCredentials: () => AgentCredentials | null
) {
  server.tool(
    'rive_discover_bridges',
    `Discover unexpected connections between records in different Abundance RE datasets.

Finds semantic and structural bridges between leads, deals, properties, transcripts, and emails.
Useful for:
- Finding related leads/investors from call transcripts
- Linking email conversations to specific deals
- Detecting investor networks
- Identifying repeat customers across datasets

Returns bridge pairs with relationship type and confidence score.
Requires at least 2 corpora to discover bridges between.`,
    BridgesInputSchema.shape,
    async (params) => {
      const creds = getCredentials();
      if (!creds) {
        return {
          content: [{ type: 'text' as const, text: 'Authentication required' }],
          isError: true,
        };
      }

      const gate = farnsworthService.enforceGate(
        creds.agentId,
        'rive_discover_bridges',
        params.corpus
      );
      if (!gate.allowed) {
        return {
          content: [{ type: 'text' as const, text: `Access denied: ${gate.reason}` }],
          isError: true,
        };
      }

      try {
        const result = await engineService.discoverBridges(
          params.corpus,
          params.threshold
        );

        const bridges = result.bridges
          .filter((b: any) => (b.strength || b.affinity || 0) >= params.threshold)
          .slice(0, params.max_bridges)
          .map((b: any) => ({
            id: b.id || `${b.sourceNodeId}-${b.targetNodeId}`,
            sourceNodeId: b.sourceNodeId || 'unknown',
            targetNodeId: b.targetNodeId || 'unknown',
            sourceDomain: b.sourceDomain || 'unknown',
            targetDomain: b.targetDomain || 'unknown',
            strength: b.strength || b.affinity || 0,
          }));

        const toolResult: BridgeDiscoveryResult = {
          bridges,
          totalBridges: bridges.length,
        };

        log.info(
          {
            agentId: creds.agentId,
            corpora: params.corpus,
            bridgesFound: bridges.length,
          },
          'Bridge discovery completed'
        );

        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(toolResult, null, 2) },
          ],
        };
      } catch (err: any) {
        log.error({ err }, 'Bridge discovery failed');
        return {
          content: [
            { type: 'text' as const, text: `Bridge discovery error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );
}

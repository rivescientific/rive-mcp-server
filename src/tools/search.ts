import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SearchInputSchema } from '../schemas/index.js';
import type { RiveEngineService } from '../services/rive-engine.js';
import type { FarnsworthService } from '../services/farnsworth.js';
import type { AgentCredentials, SearchToolResult } from '../types.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('tool:search');

export function registerSearchTool(
  server: McpServer,
  engineService: RiveEngineService,
  farnsworthService: FarnsworthService,
  getCredentials: () => AgentCredentials | null
) {
  server.tool(
    'rive_search',
    `Search across indexed datasets using Rive's cooperative binding engine.

Finds answers across multiple data sources (Supabase leads/deals/properties, Zoho CRM, call transcripts, emails) by establishing dynamic binding sites between query fragments and data fragments.

Supports three search modes:
- streaming: Fast approximate search
- refinement: Multi-pass refinement for better accuracy
- semantic: LLM-enhanced search for complex queries

Farnsworth immunity is enabled by default — anomalous results are flagged.
Returns matched records with binding confidence scores and cross-dataset bridges.`,
    SearchInputSchema.shape,
    async (params) => {
      const creds = getCredentials();
      if (!creds) {
        return {
          content: [{ type: 'text' as const, text: 'Authentication required' }],
          isError: true,
        };
      }

      // PRC2 gate check
      const gate = farnsworthService.enforceGate(
        creds.agentId,
        'rive_search',
        params.corpus
      );
      if (!gate.allowed) {
        log.warn({ agentId: creds.agentId, reason: gate.reason }, 'PRC2 gate blocked search');
        return {
          content: [{ type: 'text' as const, text: `Access denied: ${gate.reason}` }],
          isError: true,
        };
      }

      try {
        // Enforce max results based on agent level
        const maxResults = Math.min(
          params.limit,
          farnsworthService.getMaxResults(creds.agentId)
        );

        const result = await engineService.search(params.query, params.corpus, {
          mode: params.mode as any,
          limit: maxResults,
        });

        const resultBridges = result.bridges || [];

        // Run Farnsworth immunity check if requested
        let immunityFlags: SearchToolResult['immunityFlags'] = [];
        if (params.immunity_check && resultBridges.length > 0) {
          immunityFlags = await farnsworthService.scanResults(
            resultBridges as any,
            { query: params.query, corpus: params.corpus }
          );
        }

        const toolResult: SearchToolResult = {
          matches: result.matches.map((m) => ({
            id: m.corpusFragmentId,
            content: m.corpusFragmentId,
            affinity: m.affinity,
            bindingState: m.bindingState,
            source: params.corpus[0] || 'unknown',
            metadata: m.metadata,
          })),
          bridges: resultBridges.map((b: any) => ({
            sourceId: b.sourceNodeId || b.id,
            targetId: b.targetNodeId || b.id,
            sourceDomain: b.sourceDomain || 'unknown',
            targetDomain: b.targetDomain || 'unknown',
            strength: b.strength || b.affinity || 0,
          })),
          totalAffinity: result.totalAffinity,
          resultCount: result.matches.length,
          immunityFlags,
        };

        log.info(
          {
            agentId: creds.agentId,
            query: params.query.slice(0, 50),
            matches: result.matches.length,
            bridges: resultBridges.length,
            flags: immunityFlags.length,
          },
          'Search completed'
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(toolResult, null, 2),
            },
          ],
        };
      } catch (err: any) {
        log.error({ err, agentId: creds.agentId }, 'Search failed');
        return {
          content: [
            { type: 'text' as const, text: `Search error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );
}

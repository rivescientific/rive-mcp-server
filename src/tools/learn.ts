import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LearnInputSchema } from '../schemas/index.js';
import type { RiveEngineService } from '../services/rive-engine.js';
import type { FarnsworthService } from '../services/farnsworth.js';
import type { StatePersistence } from '../services/state-persistence.js';
import type { AgentCredentials, LearnResult } from '../types.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('tool:learn');

export function registerLearnTool(
  server: McpServer,
  engineService: RiveEngineService,
  farnsworthService: FarnsworthService,
  persistence: StatePersistence,
  getCredentials: () => AgentCredentials | null
) {
  server.tool(
    'rive_learn',
    `Feed back search results to improve Rive's binding sites.

Tell Rive when search results are good, bad, or partial.
Rive uses this feedback to update binding sites via Farnsworth's methylation cascade:
- Positive feedback strengthens bindings (CHH \u2192 CHG \u2192 CG promotion)
- Negative feedback flags bindings for demotion
- Partial feedback indicates the result was on the right track but incomplete

Over time, this creates a self-improving search engine tuned to Abundance RE's deal patterns.`,
    LearnInputSchema.shape,
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
        'rive_learn',
        params.corpus
      );
      if (!gate.allowed) {
        return {
          content: [{ type: 'text' as const, text: `Access denied: ${gate.reason}` }],
          isError: true,
        };
      }

      try {
        // Re-run the query to get the SearchResult object for learning
        const searchResult = await engineService.search(
          params.query,
          params.corpus,
          { limit: 10 }
        );

        // Apply learning
        const learnResult = await engineService.learn(searchResult);

        // Log the binding for analytics
        await persistence.logBinding(
          params.query,
          params.result_id,
          params.feedback === 'positive' ? 1.0 : params.feedback === 'partial' ? 0.5 : 0.0,
          params.corpus.join(','),
          params.result_id,
          params.feedback,
          creds.agentId
        );

        const result: LearnResult = {
          accepted: true,
          bindingsUpdated: learnResult.bindingsUpdated,
          methylationApplied: params.feedback !== 'partial',
          message:
            params.feedback === 'positive'
              ? `Bindings strengthened for ${learnResult.bindingsUpdated} sites`
              : params.feedback === 'negative'
              ? `Bindings flagged for demotion (${learnResult.bindingsUpdated} sites)`
              : `Partial feedback recorded for ${learnResult.bindingsUpdated} sites`,
        };

        log.info(
          {
            agentId: creds.agentId,
            feedback: params.feedback,
            bindings: learnResult.bindingsUpdated,
          },
          'Learning applied'
        );

        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err: any) {
        log.error({ err }, 'Learn failed');
        return {
          content: [
            { type: 'text' as const, text: `Learn error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );
}

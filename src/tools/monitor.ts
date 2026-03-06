import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MonitorInputSchema } from '../schemas/index.js';
import type { RiveEngineService } from '../services/rive-engine.js';
import type { FarnsworthService } from '../services/farnsworth.js';
import type { AgentCredentials } from '../types.js';
import type { LensAdapter } from '@rive-scientific/rive-sdk';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('tool:monitor');

/**
 * Convert a Zod-parsed lens (categories as Record<string, string[]>)
 * into the LensAdapter format the coordinator expects (categories as Record<string, Set<string>>).
 */
function toLensAdapter(
  raw: { id: string; categoryNames: string[]; categories: Record<string, string[]> }
): LensAdapter {
  const categories: Record<string, Set<string>> = {};
  for (const [cat, terms] of Object.entries(raw.categories)) {
    categories[cat] = new Set(terms);
  }
  return {
    id: raw.id,
    categoryNames: raw.categoryNames,
    categories,
  };
}

export function registerMonitorTool(
  server: McpServer,
  engineService: RiveEngineService,
  _farnsworthService: FarnsworthService,
  getCredentials: () => AgentCredentials | null
) {
  server.tool(
    'rive_monitor',
    `Monitor a new document against a corpus using Rive's immunity system.

Automatically uses streaming mode with full immunity calibration. Learns the corpus, calibrates self/non-self discrimination, then assesses the new document for nativeness and drift.

Returns both a drift comparison (emerged/vanished/stable terms, similarity metrics) and an immunity assessment:
- isNative: whether the document belongs to the corpus
- confidence: how certain the assessment is (0-1)
- anomalyType: 'native', 'drifted', 'partial_match', 'corrupted', or 'domain_foreign'

If a Farnsworth lens is provided, drift terms are classified into semantic categories.

Use cases:
- Detect if a new lead/deal/property listing is anomalous
- Monitor incoming documents for domain drift
- Flag foreign or corrupted data before it enters the pipeline`,
    MonitorInputSchema.shape,
    async (params) => {
      const creds = getCredentials();
      if (!creds) {
        return {
          content: [{ type: 'text' as const, text: 'Authentication required' }],
          isError: true,
        };
      }

      try {
        const lens = params.lens ? toLensAdapter(params.lens) : undefined;
        const result = engineService.monitor(params.corpus, params.new_document, lens);

        log.info(
          {
            agentId: creds.agentId,
            corpusSize: params.corpus.length,
            isNative: result.immunity.isNative,
            anomalyType: result.immunity.anomalyType,
            confidence: result.immunity.confidence.toFixed(3),
            emerged: result.comparison.emerged.length,
            dominant: result.comparison.lens?.dominantCategory || 'no-lens',
          },
          'Monitor completed'
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        log.error({ err, agentId: creds.agentId }, 'Monitor failed');
        return {
          content: [
            { type: 'text' as const, text: `Monitor error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );
}

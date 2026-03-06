import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompareInputSchema } from '../schemas/index.js';
import type { RiveEngineService } from '../services/rive-engine.js';
import type { FarnsworthService } from '../services/farnsworth.js';
import type { AgentCredentials } from '../types.js';
import type { LensAdapter } from '@rive-scientific/rive-sdk';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('tool:compare');

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

export function registerCompareTool(
  server: McpServer,
  engineService: RiveEngineService,
  _farnsworthService: FarnsworthService,
  getCredentials: () => AgentCredentials | null
) {
  server.tool(
    'rive_compare',
    `Compare two documents using Rive's temporal drift engine.

Automatically uses streaming mode to detect what vocabulary emerged, vanished, or remained stable between two document versions. Returns cosine and Jaccard similarity, drift magnitude, and binding site statistics.

If a Farnsworth lens is provided (e.g. Code, Financial Risk, PICO), emerged terms are classified into semantic categories with a full breakdown, dominant category, and ML-ready feature vector.

Use cases:
- Compare two versions of a contract, filing, or codebase
- Detect what changed semantically between document revisions
- Classify the type of change using a domain-specific lens`,
    CompareInputSchema.shape,
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
        const result = engineService.compare(params.before, params.after, lens);

        log.info(
          {
            agentId: creds.agentId,
            emerged: result.emerged.length,
            vanished: result.vanished.length,
            drift: result.driftMagnitude.toFixed(3),
            dominant: result.lens?.dominantCategory || 'no-lens',
          },
          'Compare completed'
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
        log.error({ err, agentId: creds.agentId }, 'Compare failed');
        return {
          content: [
            { type: 'text' as const, text: `Compare error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );
}

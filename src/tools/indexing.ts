import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { IndexDatasetInputSchema } from '../schemas/index.js';
import type { RiveEngineService } from '../services/rive-engine.js';
import type { FarnsworthService } from '../services/farnsworth.js';
import type { StatePersistence } from '../services/state-persistence.js';
import type { SupabaseDataAdapter } from '../services/supabase-adapter.js';
import type { ZohoDataAdapter } from '../services/zoho-adapter.js';
import type { AgentCredentials, IndexingResult, DataSourceId } from '../types.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('tool:indexing');

export function registerIndexingTool(
  server: McpServer,
  engineService: RiveEngineService,
  farnsworthService: FarnsworthService,
  persistence: StatePersistence,
  supabaseAdapter: SupabaseDataAdapter,
  zohoAdapter: ZohoDataAdapter,
  getCredentials: () => AgentCredentials | null
) {
  server.tool(
    'rive_index_dataset',
    `Trigger indexing of a data source into Rive's search engine.

Loads data from the specified source and indexes it for search.
Sources: supabase_leads, supabase_deals, supabase_properties, zoho_crm, transcripts, emails.

Indexing runs automatically on a schedule, but can be triggered manually for:
- Fresh data that needs to be searchable immediately
- After bulk data imports or corrections
- When search results seem stale

Returns job status and record count.`,
    IndexDatasetInputSchema.shape,
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
        'rive_index_dataset',
        [params.source]
      );
      if (!gate.allowed) {
        return {
          content: [{ type: 'text' as const, text: `Access denied: ${gate.reason}` }],
          isError: true,
        };
      }

      try {
        // Create indexing job
        const jobId = await persistence.createIndexingJob(
          params.source,
          params.dataset_id
        );

        await persistence.updateIndexingJob(jobId, {
          status: 'in_progress',
          started_at: new Date().toISOString(),
        });

        // Load dataset from appropriate adapter
        let dataset;
        const source = params.source as DataSourceId;

        if (source === 'zoho_crm') {
          dataset = await zohoAdapter.loadDataset();
        } else {
          dataset = await supabaseAdapter.loadDataset(source);
        }

        // Index into Rive
        const recordCount = await engineService.indexDataset(dataset, source);

        await persistence.updateIndexingJob(jobId, {
          status: 'complete',
          record_count: recordCount,
          completed_at: new Date().toISOString(),
        });

        // Run post-index calibration (consolidation + immunity)
        let calibration;
        try {
          calibration = await engineService.runPostIndexCalibration();
          log.info(
            {
              bindingSites: calibration.bindingSites,
              immunityCalibrated: calibration.immunityCalibrated,
              consolidated: calibration.consolidated,
            },
            'Post-index calibration completed'
          );
        } catch (calErr: any) {
          log.warn({ err: calErr }, 'Post-index calibration failed (non-fatal)');
          calibration = null;
        }

        const result: IndexingResult = {
          jobId,
          source: params.source,
          status: 'complete',
          recordCount,
          message: `Indexed ${recordCount} records from ${params.source}`,
        };

        // Append calibration info to result
        const fullResult = calibration
          ? {
              ...result,
              calibration: {
                bindingSites: calibration.bindingSites,
                immunityCalibrated: calibration.immunityCalibrated,
                methylationCycle: calibration.consolidated.total > 0 ? 1 : 0,
                consolidated: calibration.consolidated,
              },
            }
          : result;

        log.info(
          { agentId: creds.agentId, source: params.source, records: recordCount },
          'Indexing completed'
        );

        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(fullResult, null, 2) },
          ],
        };
      } catch (err: any) {
        log.error({ err, source: params.source }, 'Indexing failed');
        return {
          content: [
            { type: 'text' as const, text: `Indexing error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );
}

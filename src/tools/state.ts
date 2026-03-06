import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GetStateInputSchema, SetStateInputSchema } from '../schemas/index.js';
import { deserializeState } from '@rive-scientific/rive-sdk';
import type { RiveEngineService } from '../services/rive-engine.js';
import type { FarnsworthService } from '../services/farnsworth.js';
import type { AgentCredentials, EngineStateResult } from '../types.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('tool:state');

export function registerStateTools(
  server: McpServer,
  engineService: RiveEngineService,
  farnsworthService: FarnsworthService,
  getCredentials: () => AgentCredentials | null
) {
  // ── rive_get_state ──
  server.tool(
    'rive_get_state',
    `Retrieve current Rive engine state snapshot.

Returns:
- Active corpora and their record counts
- Number of binding sites
- Current operating mode
- Methylation cycle count
- Immunity calibration status
- Server uptime

Useful for monitoring engine health and diagnosing search issues.`,
    GetStateInputSchema.shape,
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
        'rive_get_state',
        []
      );
      if (!gate.allowed) {
        return {
          content: [{ type: 'text' as const, text: `Access denied: ${gate.reason}` }],
          isError: true,
        };
      }

      try {
        const corporaInfo = engineService.getCorpusInfo();
        const farnsworthMetrics = farnsworthService.getMetrics();

        const result: EngineStateResult = {
          mode: engineService.getMode(),
          corpora: corporaInfo,
          bindingSites: engineService.getBindingSiteCount(),
          methylationCycle: engineService.getMethylationCycle(),
          immunityCalibrated: engineService.isImmunityCalibrated(),
          uptime: engineService.getUptime(),
        };

        if (!params.summary_only) {
          // Include Farnsworth metrics
          (result as any).farnsworth = farnsworthMetrics;
        }

        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err: any) {
        log.error({ err }, 'Get state failed');
        return {
          content: [
            { type: 'text' as const, text: `State error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ── rive_set_state ──
  server.tool(
    'rive_set_state',
    `Restore Rive engine from a saved state snapshot.

Use this to roll back to a previous engine state if:
- Search quality has degraded
- Bad data was indexed
- You need to restore from a backup

Requires HIGH access level. Overwrites the current engine state.`,
    SetStateInputSchema.shape,
    async (params) => {
      const creds = getCredentials();
      if (!creds) {
        return {
          content: [{ type: 'text' as const, text: 'Authentication required' }],
          isError: true,
        };
      }

      // Only HIGH access agents can restore state
      if (creds.accessLevel !== 'HIGH') {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Access denied: Only HIGH access agents can restore engine state',
            },
          ],
          isError: true,
        };
      }

      try {
        const state = deserializeState(params.state_json);
        await engineService.setState(state);

        log.info(
          { agentId: creds.agentId, reason: params.reason },
          'Engine state restored'
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                restored: true,
                reason: params.reason || 'Manual restore',
                message: 'Engine state has been restored. Search results will reflect the restored state.',
              }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        log.error({ err }, 'State restore failed');
        return {
          content: [
            { type: 'text' as const, text: `Restore error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImmunityInputSchema, StressInputSchema } from '../schemas/index.js';
import type { RiveEngineService } from '../services/rive-engine.js';
import type { FarnsworthService } from '../services/farnsworth.js';
import type { AgentCredentials, ImmunityResult, StressResult } from '../types.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('tool:immunity');

export function registerImmunityTools(
  server: McpServer,
  engineService: RiveEngineService,
  farnsworthService: FarnsworthService,
  getCredentials: () => AgentCredentials | null
) {
  // ── rive_assess_immunity ──
  server.tool(
    'rive_assess_immunity',
    `Check if a query or data pattern is anomalous, adversarial, or foreign.

Uses Farnsworth's RISC (RNA-Induced Silencing Complex) to detect:
- FALSE_POSITIVE_BRIDGE: Spurious connections between unrelated data
- STRUCTURAL_MISLEAD: Malformed data patterns designed to mislead
- ADVERSARIAL_QUERY: Injection attempts or malicious queries
- POISONED_NODE: Corrupted data in the index
- STALE_BRIDGE: Outdated connections that no longer hold

Returns threat assessment with confidence scores and recommendations.
Essential for data quality assurance in the deal pipeline.`,
    ImmunityInputSchema.shape,
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
        'rive_assess_immunity',
        params.corpus
      );
      if (!gate.allowed) {
        return {
          content: [{ type: 'text' as const, text: `Access denied: ${gate.reason}` }],
          isError: true,
        };
      }

      try {
        const assessment = await engineService.assessImmunity(
          params.query,
          params.corpus
        );

        const result: ImmunityResult = {
          isNative: assessment.isNative,
          confidence: assessment.confidence,
          s2HitRatio: assessment.s2HitRatio,
          threats: (assessment.stressFragments || []).map((sf: any) => ({
            type: sf.type || 'unknown',
            matchScore: sf.confidence || sf.matchScore || 0,
            action: sf.action || 'flag_and_report',
          })),
          recommendation: assessment.isNative
            ? 'Query pattern recognized as native. Safe to proceed.'
            : assessment.confidence < 0.3
            ? 'LOW CONFIDENCE: Query pattern is highly foreign. Review manually before acting on results.'
            : 'MODERATE: Query pattern partially recognized. Results may need validation.',
        };

        log.info(
          {
            agentId: creds.agentId,
            isNative: result.isNative,
            confidence: result.confidence,
            threats: result.threats.length,
          },
          'Immunity assessment completed'
        );

        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err: any) {
        log.error({ err }, 'Immunity assessment failed');
        return {
          content: [
            { type: 'text' as const, text: `Immunity error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ── rive_diagnose_stress ──
  server.tool(
    'rive_diagnose_stress',
    `Run a detailed inflammasome diagnosis on a query.

Goes deeper than assess_immunity \u2014 provides full stress analysis including:
- Anomaly type classification (native, domain_foreign, partial_match, corrupted, drifted)
- Stress fragment count and details
- Suppression signature
- Diagnostic timing

Use this when assess_immunity flags something and you need to understand WHY.`,
    StressInputSchema.shape,
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
        'rive_diagnose_stress',
        params.corpus
      );
      if (!gate.allowed) {
        return {
          content: [{ type: 'text' as const, text: `Access denied: ${gate.reason}` }],
          isError: true,
        };
      }

      try {
        const diagnosis = await engineService.diagnoseStress(
          params.query,
          params.corpus
        );

        const result: StressResult = {
          isNative: diagnosis.isNative,
          anomalyType: diagnosis.anomalyType,
          s2HitRatio: diagnosis.s2HitRatio,
          stressFragments: diagnosis.stressFragments.length,
          suppressionSignature: diagnosis.suppressionSignature,
          diagnosticMs: diagnosis.diagnosticMs,
        };

        log.info(
          {
            agentId: creds.agentId,
            anomalyType: result.anomalyType,
            stressFragments: result.stressFragments,
          },
          'Stress diagnosis completed'
        );

        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err: any) {
        log.error({ err }, 'Stress diagnosis failed');
        return {
          content: [
            { type: 'text' as const, text: `Stress diagnosis error: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );
}

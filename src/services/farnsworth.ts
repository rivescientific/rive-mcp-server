import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const farnsworthCore = require('@rive/farnsworth-core');

// Destructure all needed functions/values from the CJS module
const {
  createRISC,
  loadSiRNAIntoRISC,
  scanWithRISC,
  determineAction,
  recordFalseAlarm,
  getFalsePositiveRate,
  ThreatType,
  applyPRC2Gating,
  evaluateGateLift,
  createGatingRule,
  createDevelopmentalStage,
  GatingContext,
  DEFAULT_PRC2_CONFIG,
  createDefaultEpigeneticState,
  createTrait,
  MethylationContext: MC,
} = farnsworthCore;

import type {
  RISCComplex,
  SiRNA,
  SiRNAScanResult,
  Bridge,
  PRC2Complex,
  GatingRule,
  DevelopmentalStage,
  GateLiftResult,
  EpigeneticTrait,
  MethylationContext,
} from '@rive/farnsworth-core';

import { createChildLogger } from '../utils/logger.js';
import type { PRC2GateConfig, ImmunityFlag, AccessLevel } from '../types.js';

const log = createChildLogger('farnsworth');

// ── PRC2 Gate Configurations ──

const PRC2_GATES: Record<string, PRC2GateConfig> = {
  acquisitions_analyst: {
    agentId: 'acquisitions_analyst',
    accessLevel: 'HIGH',
    allowedCorpora: [
      'supabase_leads', 'supabase_deals', 'supabase_properties',
      'zoho_crm', 'transcripts', 'emails',
    ],
    allowedTools: [
      'rive_search', 'rive_discover_bridges', 'rive_learn',
      'rive_assess_immunity', 'rive_diagnose_stress', 'rive_get_state',
    ],
    maxResultsPerSearch: 100,
    canTriggerIndexing: true,
    methylationRights: ['chh', 'chg', 'cg'],
  },
  lead_qualifier: {
    agentId: 'lead_qualifier',
    accessLevel: 'MEDIUM',
    allowedCorpora: ['supabase_leads', 'transcripts'],
    allowedTools: [
      'rive_search', 'rive_assess_immunity', 'rive_learn',
    ],
    maxResultsPerSearch: 50,
    canTriggerIndexing: false,
    methylationRights: ['chh'],
  },
  deal_underwriter: {
    agentId: 'deal_underwriter',
    accessLevel: 'HIGH',
    allowedCorpora: [
      'supabase_deals', 'supabase_properties', 'emails', 'transcripts',
    ],
    allowedTools: [
      'rive_search', 'rive_discover_bridges', 'rive_learn',
      'rive_assess_immunity', 'rive_get_state',
    ],
    maxResultsPerSearch: 100,
    canTriggerIndexing: false,
    methylationRights: ['chh', 'chg', 'cg'],
  },
  dispositions_coordinator: {
    agentId: 'dispositions_coordinator',
    accessLevel: 'MEDIUM',
    allowedCorpora: [
      'supabase_deals', 'supabase_properties', 'supabase_leads',
    ],
    allowedTools: [
      'rive_search', 'rive_discover_bridges', 'rive_learn',
    ],
    maxResultsPerSearch: 50,
    canTriggerIndexing: false,
    methylationRights: ['chh', 'chg'],
  },
  marketing_agent: {
    agentId: 'marketing_agent',
    accessLevel: 'READ_MOSTLY',
    allowedCorpora: ['supabase_properties', 'supabase_deals'],
    allowedTools: ['rive_search', 'rive_learn'],
    maxResultsPerSearch: 30,
    canTriggerIndexing: false,
    methylationRights: ['chh'],
  },
  compliance_docs: {
    agentId: 'compliance_docs',
    accessLevel: 'HIGH',
    allowedCorpora: [
      'supabase_deals', 'supabase_properties', 'emails', 'zoho_crm',
    ],
    allowedTools: ['rive_search', 'rive_assess_immunity'],
    maxResultsPerSearch: 200,
    canTriggerIndexing: false,
    methylationRights: ['chg', 'cg'],
  },
  mary_ai_coordinator: {
    agentId: 'mary_ai_coordinator',
    accessLevel: 'MEDIUM',
    allowedCorpora: ['transcripts', 'supabase_leads'],
    allowedTools: ['rive_search', 'rive_learn'],
    maxResultsPerSearch: 50,
    canTriggerIndexing: false,
    methylationRights: ['chh'],
  },
};

export class FarnsworthService {
  private risc: RISCComplex;
  private prc2Config: PRC2Complex;
  private developmentalStage: DevelopmentalStage;

  constructor() {
    this.risc = createRISC('rive-mcp-main', 100);
    this.prc2Config = { ...DEFAULT_PRC2_CONFIG };
    this.developmentalStage = createDevelopmentalStage(
      'operational',
      'Operational Stage',
      100
    );
  }

  // ── PRC2 Gating ──

  enforceGate(
    agentId: string,
    toolName: string,
    requestedCorpora: string[]
  ): { allowed: boolean; reason?: string } {
    const gate = PRC2_GATES[agentId];

    if (!gate) {
      log.warn({ agentId }, 'Agent not found in PRC2 gates');
      return { allowed: false, reason: `Agent '${agentId}' not registered in PRC2 gating` };
    }

    // Check tool access
    if (!gate.allowedTools.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool '${toolName}' not permitted for agent '${agentId}' (access level: ${gate.accessLevel})`,
      };
    }

    // Check corpus access
    if (requestedCorpora.length > 0) {
      const disallowed = requestedCorpora.filter(
        (c) => !gate.allowedCorpora.includes(c)
      );
      if (disallowed.length > 0) {
        return {
          allowed: false,
          reason: `Agent '${agentId}' cannot access corpora: ${disallowed.join(', ')}`,
        };
      }
    }

    // Check indexing permission
    if (toolName === 'rive_index_dataset' && !gate.canTriggerIndexing) {
      return {
        allowed: false,
        reason: `Agent '${agentId}' cannot trigger indexing`,
      };
    }

    return { allowed: true };
  }

  getGateConfig(agentId: string): PRC2GateConfig | null {
    return PRC2_GATES[agentId] || null;
  }

  getMaxResults(agentId: string): number {
    const gate = PRC2_GATES[agentId];
    return gate?.maxResultsPerSearch || 20;
  }

  // ── RISC Immunity ──

  async scanResults(
    bridges: Bridge[],
    queryContext: { query: string; corpus: string[] }
  ): Promise<ImmunityFlag[]> {
    const context = {
      query: queryContext.query,
      corpus: queryContext.corpus,
      timestamp: Date.now(),
    };

    const scanResults: SiRNAScanResult[] = scanWithRISC(
      this.risc,
      context as any,
      bridges
    );

    return scanResults.map((sr) => ({
      type: sr.siRNA.threatType,
      matchedBridgeId: sr.matchedBridge.id,
      confidence: sr.matchScore,
      recommendedAction: sr.recommendedAction,
    }));
  }

  loadThreatPattern(siRNA: SiRNA): boolean {
    return loadSiRNAIntoRISC(this.risc, siRNA);
  }

  reportFalseAlarm(siRNAId: string): void {
    recordFalseAlarm(this.risc, siRNAId);
  }

  getFalsePositiveRate(): number {
    return getFalsePositiveRate(this.risc);
  }

  // ── Methylation helpers ──

  createTraitFromResult(
    id: string,
    pattern: string
  ): EpigeneticTrait {
    return createTrait(id, pattern);
  }

  // ── Info ──

  getMetrics(): {
    loadedGuides: number;
    maxGuides: number;
    matchesFound: number;
    falseAlarms: number;
    falsePositiveRate: number;
  } {
    return {
      loadedGuides: this.risc.loadedGuides.length,
      maxGuides: this.risc.maxGuides,
      matchesFound: this.risc.matchesFound,
      falseAlarms: this.risc.falseAlarms,
      falsePositiveRate: getFalsePositiveRate(this.risc),
    };
  }
}

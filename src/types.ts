/**
 * Shared types for the Rive MCP Server.
 * These mirror/extend the Rive SDK and Farnsworth Core types
 * for use in the MCP tool layer.
 */

// ── Agent & Auth ──

export interface AgentCredentials {
  agentId: string;
  accessLevel: AccessLevel;
  allowedCorpora: string[];
  allowedTools: string[];
}

export type AccessLevel = 'HIGH' | 'MEDIUM' | 'READ_MOSTLY';

// ── PRC2 Gating ──

export interface PRC2GateConfig {
  agentId: string;
  accessLevel: AccessLevel;
  allowedCorpora: string[];
  allowedTools: string[];
  maxResultsPerSearch: number;
  canTriggerIndexing: boolean;
  methylationRights: MethylationRight[];
}

export type MethylationRight = 'chh' | 'chg' | 'cg';

// ── Data Sources ──

export type DataSourceId =
  | 'supabase_leads'
  | 'supabase_deals'
  | 'supabase_properties'
  | 'zoho_crm'
  | 'transcripts'
  | 'emails';

export const ALL_DATA_SOURCES: DataSourceId[] = [
  'supabase_leads',
  'supabase_deals',
  'supabase_properties',
  'zoho_crm',
  'transcripts',
  'emails',
];

// ── MCP Tool Results ──

export interface SearchToolResult {
  matches: Array<{
    id: string;
    content: string;
    affinity: number;
    bindingState: string;
    source: string;
    metadata?: Record<string, unknown>;
  }>;
  bridges: Array<{
    sourceId: string;
    targetId: string;
    sourceDomain: string;
    targetDomain: string;
    strength: number;
  }>;
  totalAffinity: number;
  resultCount: number;
  immunityFlags: ImmunityFlag[];
}

export interface ImmunityFlag {
  type: string;
  matchedBridgeId: string;
  confidence: number;
  recommendedAction: string;
}

export interface BridgeDiscoveryResult {
  bridges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    sourceDomain: string;
    targetDomain: string;
    strength: number;
  }>;
  totalBridges: number;
}

export interface LearnResult {
  accepted: boolean;
  bindingsUpdated: number;
  methylationApplied: boolean;
  message: string;
}

export interface ImmunityResult {
  isNative: boolean;
  confidence: number;
  s2HitRatio: number;
  threats: Array<{
    type: string;
    matchScore: number;
    action: string;
  }>;
  recommendation: string;
}

export interface StressResult {
  isNative: boolean;
  anomalyType: string;
  s2HitRatio: number;
  stressFragments: number;
  suppressionSignature: string;
  diagnosticMs: number;
}

export interface IndexingResult {
  jobId: string;
  source: string;
  status: 'queued' | 'in_progress' | 'complete' | 'failed';
  recordCount?: number;
  message: string;
}

export interface EngineStateResult {
  mode: string;
  corpora: Array<{
    name: string;
    recordCount: number;
    lastIndexed: string;
  }>;
  bindingSites: number;
  methylationCycle: number;
  immunityCalibrated: boolean;
  uptime: string;
}

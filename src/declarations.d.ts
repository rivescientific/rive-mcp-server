// Type declarations for private dependencies
// These packages are built from source in the Docker build without --dts,
// so we declare them here to satisfy TypeScript module resolution.

declare module '@rive-scientific/rive-sdk' {
  export function createEngine(config: any): RiveEngine;
  export function serializeState(state: NetworkState): string;
  export function deserializeState(serialized: string): NetworkState;

  export interface RiveEngine {
    search(query: string, corpus: string[], options?: QueryOptions): SearchResult;
    learn(result: SearchResult): void;
    indexDataset(dataset: Dataset): void;
    getState(): NetworkState;
    setState(state: NetworkState): void;
    getMode(): OperatingMode;
    setMode(mode: OperatingMode): void;
    consolidate(): { demoted: number; survived: number; total: number };
    calibrateImmunity(queries: string[], corpus: string[]): ImmunityCalibration;
    assessImmunity(query: string, corpus: string[], calibration?: ImmunityCalibration): ImmunityAssessment;
    diagnoseStress(query: string, corpus: string[], calibration?: ImmunityCalibration): StressDiagnosis;
  }

  export interface DomainConfig {
    name: string;
    mode?: string;
    metadata?: Record<string, any>;
    [key: string]: any;
  }

  export interface SearchResult {
    matches: Array<{
      id: string;
      score: number;
      content: string;
      metadata?: Record<string, any>;
      [key: string]: any;
    }>;
    bridges?: any[];
    [key: string]: any;
  }

  export interface Dataset {
    records: Array<{
      id: string;
      content: string;
      metadata?: Record<string, any>;
      [key: string]: any;
    }>;
    [key: string]: any;
  }

  export type OperatingMode = 'semantic' | 'structural' | 'hybrid' | string;

  export interface ImmunityCalibration {
    [key: string]: any;
  }

  export interface ImmunityAssessment {
    [key: string]: any;
  }

  export interface StressDiagnosis {
    [key: string]: any;
  }

  export interface NetworkState {
    [key: string]: any;
  }

  export interface QueryOptions {
    maxResults?: number;
    enableBridges?: boolean;
    enableLearning?: boolean;
    datasets?: string[];
    [key: string]: any;
  }

  // ── Coordinator (compare/monitor with auto-mode selection) ──

  export function createCoordinator(config?: Partial<CoordinatorConfig>): RiveCoordinator;

  export interface CoordinatorConfig {
    [key: string]: any;
  }

  export interface LensAdapter {
    id: string;
    categoryNames: readonly string[];
    categories: Record<string, Set<string>>;
  }

  export type EmergedTerm = [string, number];

  export interface ComparisonResult {
    similarity: { cosine: number; jaccard: number };
    emerged: EmergedTerm[];
    vanished: EmergedTerm[];
    stable: EmergedTerm[];
    driftMagnitude: number;
    engineStats: { s0: number; s1: number; s2: number; totalSites: number };
    lens?: {
      lensId: string;
      categoryBreakdown: Record<string, number>;
      categoryPercentages: Record<string, number>;
      dominantCategory: string;
      shiftConcentration: number;
      features: Record<string, number>;
    };
  }

  export interface MonitorResult {
    comparison: ComparisonResult;
    immunity: {
      isNative: boolean;
      confidence: number;
      s2HitRatio: number;
      anomalyType: string;
    };
  }

  export interface RiveCoordinator {
    index(documents: Array<{ id: string; content: string }>): void;
    search(query: string, options?: any): any;
    findDocuments(query: string, options?: any): any;
    rankPages(docId: string, query: string, options?: any): any;
    annotateBridges(docId: string, query: string, options?: any): any;
    formatForLLM(result: any, options?: any): string;
    getStats(): any;
    compare(before: string, after: string, lens?: LensAdapter): ComparisonResult;
    monitor(corpus: string[], newDocument: string, lens?: LensAdapter): MonitorResult;
  }
}

declare module '@rive-scientific/rive-sdk/farnsworth' {
  import type { DomainConfig } from '@rive-scientific/rive-sdk';

  export const FARNSWORTH_CONFIG: DomainConfig;
  export function createFarnsworthConfig(options: {
    name: string;
    mode?: string;
    metadata?: Record<string, any>;
  }): DomainConfig;
}

declare module '@rive/farnsworth-core' {
  // RISC Complex (immunity subsystem)
  export function createRISC(id: string, maxGuides: number): RISCComplex;
  export function loadSiRNAIntoRISC(risc: RISCComplex, siRNA: SiRNA): boolean;
  export function scanWithRISC(risc: RISCComplex, context: any, bridges: Bridge[]): SiRNAScanResult[];
  export function determineAction(scanResult: SiRNAScanResult): string;
  export function recordFalseAlarm(risc: RISCComplex, siRNAId: string): void;
  export function getFalsePositiveRate(risc: RISCComplex): number;

  export interface RISCComplex {
    id: string;
    maxGuides: number;
    loadedGuides: SiRNA[];
    matchesFound: number;
    falseAlarms: number;
    [key: string]: any;
  }

  export interface SiRNA {
    id: string;
    threatType: ThreatType;
    [key: string]: any;
  }

  export interface SiRNAScanResult {
    siRNA: SiRNA;
    matchedBridge: Bridge;
    matchScore: number;
    recommendedAction: string;
    [key: string]: any;
  }

  export interface Bridge {
    id: string;
    [key: string]: any;
  }

  export enum ThreatType {
    ADVERSARIAL = 'ADVERSARIAL',
    ANOMALOUS = 'ANOMALOUS',
    DRIFT = 'DRIFT',
    INJECTION = 'INJECTION',
  }

  // PRC2 Gating (developmental subsystem)
  export function applyPRC2Gating(config: PRC2Complex, context: GatingContext): any;
  export function evaluateGateLift(config: PRC2Complex, context: GatingContext): GateLiftResult;
  export function createGatingRule(params: any): GatingRule;
  export function createDevelopmentalStage(id: string, name: string, capacity: number): DevelopmentalStage;

  export interface PRC2Complex {
    [key: string]: any;
  }

  export interface GatingRule {
    [key: string]: any;
  }

  export interface DevelopmentalStage {
    stageId: string;
    name: string;
    accumulatedContext: number;
    requiredContext: number;
    activeGates: any[];
    completedGates: any[];
    [key: string]: any;
  }

  export interface GateLiftResult {
    [key: string]: any;
  }

  export interface GatingContext {
    [key: string]: any;
  }

  export const GatingContext: {
    [key: string]: any;
  };

  export const DEFAULT_PRC2_CONFIG: PRC2Complex;

  // Epigenetic State (methylation subsystem)
  export function createDefaultEpigeneticState(): any;
  export function createTrait(id: string, pattern: string): EpigeneticTrait;

  export interface EpigeneticTrait {
    [key: string]: any;
  }

  export interface MethylationContext {
    [key: string]: any;
  }

  export const MethylationContext: {
    CHH: string;
    CHG: string;
    CG: string;
    [key: string]: any;
  };
}

// ── MCP SDK stdio transport ──
declare module '@modelcontextprotocol/sdk/server/stdio.js' {
  export class StdioServerTransport {
    constructor();
  }
}

// ── Azure dependencies (optional, installed for enterprise deployments) ──
declare module 'mssql' {
  const mssql: {
    connect(config: any): Promise<any>;
    [key: string]: any;
  };
  export default mssql;
}

declare module '@azure/storage-blob' {
  export class BlobServiceClient {
    static fromConnectionString(connectionString: string): BlobServiceClient;
    getContainerClient(name: string): any;
    [key: string]: any;
  }
}

declare module '@azure/identity' {
  export class DefaultAzureCredential {
    getToken(scope: string): Promise<{ token: string }>;
  }
}

// ── Node.js globals ──
declare var process: {
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  [key: string]: any;
};

declare var console: {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn(...args: any[]): void;
  info(...args: any[]): void;
};

declare class Buffer {
  static from(data: any): Buffer;
  static concat(buffers: Buffer[]): Buffer;
  toString(encoding?: string): string;
}

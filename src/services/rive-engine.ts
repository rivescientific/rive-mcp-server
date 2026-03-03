import {
  createEngine,
  type RiveEngine,
  type DomainConfig,
  type SearchResult,
  type Dataset,
  type OperatingMode,
  type ImmunityCalibration,
  type ImmunityAssessment,
  type StressDiagnosis,
  type NetworkState,
  type QueryOptions,
} from '@rive-scientific/rive-sdk';
import {
  FARNSWORTH_CONFIG,
  createFarnsworthConfig,
} from '@rive-scientific/rive-sdk/farnsworth';
import { createChildLogger } from '../utils/logger.js';
import { StatePersistence } from './state-persistence.js';
import type { DataSourceId } from '../types.js';

const log = createChildLogger('rive-engine');

export class RiveEngineService {
  private engine: RiveEngine | null = null;
  private persistence: StatePersistence;
  private immunityCalibration: ImmunityCalibration | null = null;
  private indexedCorpora: Map<string, { recordCount: number; lastIndexed: Date }> = new Map();
  private startTime: Date;

  constructor(persistence: StatePersistence) {
    this.persistence = persistence;
    this.startTime = new Date();
  }

  async initialize(): Promise<void> {
    log.info('Initializing Rive engine with Farnsworth config');

    // Use the Farnsworth-enhanced config which includes methylation + immunity
    const config: DomainConfig = createFarnsworthConfig({
      name: 'abundance-re',
      mode: 'semantic',
      metadata: {
        organization: 'Abundance RE',
        purpose: 'Real estate acquisition pipeline',
      },
    });

    this.engine = createEngine(config);

    // Restore previous state if available
    const savedState = await this.persistence.loadState();
    if (savedState) {
      this.engine.setState(savedState);
      log.info('Engine state restored from persistence');
    } else {
      log.info('Engine started with fresh state');
    }
  }

  getEngine(): RiveEngine {
    if (!this.engine) {
      throw new Error('Engine not initialized. Call initialize() first.');
    }
    return this.engine;
  }

  // ── Search ──

  async search(
    query: string,
    corpus: string[],
    options?: { mode?: OperatingMode; limit?: number }
  ): Promise<SearchResult> {
    const engine = this.getEngine();

    if (options?.mode) {
      engine.setMode(options.mode);
    }

    const queryOptions: QueryOptions = {
      maxResults: options?.limit || 20,
      enableBridges: true,
      enableLearning: true,
      datasets: corpus,
    };

    const result = engine.search(query, corpus, queryOptions);

    // Persist updated state after search (learning may have occurred)
    await this.persistState();

    return result;
  }

  // ── Learn ──

  async learn(result: SearchResult): Promise<{ bindingsUpdated: number }> {
    const engine = this.getEngine();
    engine.learn(result);

    await this.persistState();

    return { bindingsUpdated: result.matches.length };
  }

  // ── Bridge Discovery ──

  async discoverBridges(
    corpus: string[],
    _threshold: number
  ): Promise<SearchResult> {
    const engine = this.getEngine();

    // Search with bridge discovery enabled across all specified corpora
    const result = engine.search('*', corpus, {
      enableBridges: true,
      enableLearning: false,
      datasets: corpus,
    });

    return result;
  }

  // ── Immunity ──

  async calibrateImmunity(
    nativeQueries: string[],
    corpus: string[]
  ): Promise<ImmunityCalibration> {
    const engine = this.getEngine();
    this.immunityCalibration = engine.calibrateImmunity(nativeQueries, corpus);
    log.info(
      { queriesUsed: nativeQueries.length },
      'Immunity calibrated'
    );
    return this.immunityCalibration;
  }

  async assessImmunity(
    query: string,
    corpus: string[]
  ): Promise<ImmunityAssessment> {
    const engine = this.getEngine();
    return engine.assessImmunity(
      query,
      corpus,
      this.immunityCalibration || undefined
    );
  }

  async diagnoseStress(
    query: string,
    corpus: string[]
  ): Promise<StressDiagnosis> {
    const engine = this.getEngine();
    return engine.diagnoseStress(
      query,
      corpus,
      this.immunityCalibration || undefined
    );
  }

  // ── Dataset Indexing ──

  async indexDataset(dataset: Dataset, source: DataSourceId): Promise<number> {
    const engine = this.getEngine();
    engine.indexDataset(dataset);

    this.indexedCorpora.set(source, {
      recordCount: dataset.records.length,
      lastIndexed: new Date(),
    });

    await this.persistState();

    log.info(
      { source, records: dataset.records.length },
      'Dataset indexed'
    );
    return dataset.records.length;
  }

  // ── State ──

  getState(): NetworkState {
    return this.getEngine().getState();
  }

  async setState(state: NetworkState): Promise<void> {
    this.getEngine().setState(state);
    await this.persistState();
  }

  getMode(): OperatingMode {
    return this.getEngine().getMode();
  }

  setMode(mode: OperatingMode): void {
    this.getEngine().setMode(mode);
  }

  consolidate(): { demoted: number; survived: number; total: number } {
    return this.getEngine().consolidate();
  }

  // ── Info ──

  getCorpusInfo(): Array<{ name: string; recordCount: number; lastIndexed: string }> {
    return Array.from(this.indexedCorpora.entries()).map(([name, info]) => ({
      name,
      recordCount: info.recordCount,
      lastIndexed: info.lastIndexed.toISOString(),
    }));
  }

  getUptime(): string {
    const ms = Date.now() - this.startTime.getTime();
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }

  // ── Private ──

  private async persistState(): Promise<void> {
    try {
      const state = this.getEngine().getState();
      await this.persistence.saveState(state, {
        corpora: this.getCorpusInfo(),
        mode: this.getMode(),
      });
    } catch (err) {
      log.error({ err }, 'Failed to persist state (non-fatal)');
    }
  }
}

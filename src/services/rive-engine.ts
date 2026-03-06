import {
  createEngine,
  createCoordinator,
  type RiveEngine,
  type RiveCoordinator,
  type DomainConfig,
  type SearchResult,
  type Dataset,
  type OperatingMode,
  type ImmunityCalibration,
  type ImmunityAssessment,
  type StressDiagnosis,
  type NetworkState,
  type QueryOptions,
  type LensAdapter,
  type ComparisonResult,
  type MonitorResult,
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
  private coordinator: RiveCoordinator | null = null;
  private persistence: StatePersistence;
  private immunityCalibration: ImmunityCalibration | null = null;
  private indexedCorpora: Map<string, { recordCount: number; lastIndexed: Date }> = new Map();
  private startTime: Date;
  private _lastConsolidateTotal: number = 0;
  private _methylationCycleCount: number = 0;

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
    this.coordinator = createCoordinator();

    // Restore previous state if available
    const savedState = await this.persistence.loadState();
    if (savedState) {
      this.engine.setState(savedState);
      log.info('Engine state restored from persistence');
    } else {
      log.info('Engine started with fresh state');
    }

    // Restore indexedCorpora from persisted metadata so rive_get_state
    // reports correct corpora even after a Railway redeploy
    await this.restoreCorporaFromMetadata();
  }

  private async restoreCorporaFromMetadata(): Promise<void> {
    try {
      const metadata = await this.persistence.loadMetadata();
      if (metadata && Array.isArray(metadata.corpora)) {
        for (const corpus of metadata.corpora as Array<{ name: string; recordCount: number; lastIndexed: string }>) {
          this.indexedCorpora.set(corpus.name, {
            recordCount: corpus.recordCount,
            lastIndexed: new Date(corpus.lastIndexed),
          });
        }
        log.info(
          { corporaCount: this.indexedCorpora.size, corpora: Array.from(this.indexedCorpora.keys()) },
          'Restored corpora metadata from persistence'
        );

        // Restore calibration metrics
        if (typeof metadata.bindingSites === 'number') {
          this._lastConsolidateTotal = metadata.bindingSites;
        }
        if (typeof metadata.methylationCycle === 'number') {
          this._methylationCycleCount = metadata.methylationCycle;
        }
        if (metadata.immunityCalibrated) {
          log.info('Previous session had immunity calibrated — will need re-calibration after next index');
        }
      }
    } catch (err) {
      log.warn({ err }, 'Failed to restore corpora metadata (non-fatal)');
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

  // ── Post-Index Calibration ──

  async runPostIndexCalibration(): Promise<{
    consolidated: { demoted: number; survived: number; total: number };
    immunityCalibrated: boolean;
    bindingSites: number;
  }> {
    const corpora = Array.from(this.indexedCorpora.keys());

    if (corpora.length === 0) {
      log.warn('No corpora indexed — skipping post-index calibration');
      return { consolidated: { demoted: 0, survived: 0, total: 0 }, immunityCalibrated: false, bindingSites: 0 };
    }

    // Step 1: Run methylation consolidation cycle
    // Use this.consolidate() so _lastConsolidateTotal and _methylationCycleCount are tracked
    log.info('Running methylation consolidation cycle...');
    const consolidated = this.consolidate();
    log.info(
      { demoted: consolidated.demoted, survived: consolidated.survived, total: consolidated.total },
      'Consolidation complete'
    );

    // Step 2: Calibrate immunity with representative native queries
    // These are queries that ARE typical for the Abundance RE domain
    const nativeQueries = [
      'find leads in Fort Lauderdale with high equity',
      'properties with ARV above 200000',
      'deals closing this month in South Florida',
      'motivated sellers with tax liens',
      'wholesale deals under contract',
      'investor buyers looking for fix and flip',
      'vacant properties in Broward County',
      'call transcripts from last week',
      'leads with multiple properties',
      'cash buyers interested in rental portfolio',
    ];

    log.info({ queryCount: nativeQueries.length, corpora }, 'Calibrating immunity...');
    await this.calibrateImmunity(nativeQueries, corpora);
    log.info('Immunity calibration complete');

    // Step 3: Persist the calibrated state
    await this.persistState();

    const bindingSites = this.getBindingSiteCount();

    log.info(
      { bindingSites, methylationCycle: this.getMethylationCycle(), immunityCalibrated: true },
      'Post-index calibration finished'
    );

    return {
      consolidated,
      immunityCalibrated: true,
      bindingSites,
    };
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
    const result = this.getEngine().consolidate();
    this._lastConsolidateTotal = result.total;
    this._methylationCycleCount++;
    return result;
  }

  // ── Calibration Status ──

  isImmunityCalibrated(): boolean {
    return this.immunityCalibration !== null;
  }

  getBindingSiteCount(): number {
    // Use the tracked consolidation total — this is authoritative.
    // The SDK's NetworkState structure doesn't expose binding sites
    // in a predictable property path, so we track it ourselves
    // from consolidate() results.
    return this._lastConsolidateTotal;
  }

  getMethylationCycle(): number {
    return this._methylationCycleCount;
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

  // ── Coordinator: Compare & Monitor ──

  getCoordinator(): RiveCoordinator {
    if (!this.coordinator) {
      throw new Error('Coordinator not initialized. Call initialize() first.');
    }
    return this.coordinator;
  }

  compare(
    before: string,
    after: string,
    lens?: LensAdapter
  ): ComparisonResult {
    const coordinator = this.getCoordinator();
    return coordinator.compare(before, after, lens);
  }

  monitor(
    corpus: string[],
    newDocument: string,
    lens?: LensAdapter
  ): MonitorResult {
    const coordinator = this.getCoordinator();
    return coordinator.monitor(corpus, newDocument, lens);
  }

  // ── Private ──

  private async persistState(): Promise<void> {
    try {
      const state = this.getEngine().getState();
      await this.persistence.saveState(state, {
        corpora: this.getCorpusInfo(),
        mode: this.getMode(),
        bindingSites: this.getBindingSiteCount(),
        methylationCycle: this._methylationCycleCount,
        immunityCalibrated: this.isImmunityCalibrated(),
      });
    } catch (err) {
      log.error({ err }, 'Failed to persist state (non-fatal)');
    }
  }
}

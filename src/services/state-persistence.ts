import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  serializeState,
  deserializeState,
  type NetworkState,
} from '@rive-scientific/rive-sdk';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('state-persistence');

export class StatePersistence {
  private supabase: SupabaseClient;
  private cachedState: NetworkState | null = null;
  private lastSavedAt: Date | null = null;

  constructor() {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    this.supabase = createClient(url, key);
  }

  async loadState(): Promise<NetworkState | null> {
    if (this.cachedState) {
      log.debug('Returning cached state');
      return this.cachedState;
    }

    try {
      const { data, error } = await this.supabase
        .from('rive_engine_state')
        .select('state, updated_at')
        .eq('id', 'current')
        .single();

      if (error || !data) {
        log.info('No saved state found, starting fresh');
        return null;
      }

      const state = deserializeState(
        typeof data.state === 'string' ? data.state : JSON.stringify(data.state)
      );
      this.cachedState = state;
      this.lastSavedAt = new Date(data.updated_at);
      log.info({ updatedAt: data.updated_at }, 'State loaded from Supabase');
      return state;
    } catch (err) {
      log.error({ err }, 'Failed to load state');
      return null;
    }
  }

  async saveState(state: NetworkState, metadata?: Record<string, unknown>): Promise<void> {
    try {
      const serialized = serializeState(state);

      const { error } = await this.supabase.from('rive_engine_state').upsert({
        id: 'current',
        state: JSON.parse(serialized),
        updated_at: new Date().toISOString(),
        metadata: metadata || {},
      });

      if (error) {
        log.error({ error }, 'Failed to save state to Supabase');
        throw error;
      }

      this.cachedState = state;
      this.lastSavedAt = new Date();
      log.info('State saved to Supabase');
    } catch (err) {
      log.error({ err }, 'State save error');
      throw err;
    }
  }

  async logBinding(
    query: string,
    bindingSite: string,
    confidence: number,
    corpus: string,
    resultId: string | null,
    feedback: string | null,
    agentId: string
  ): Promise<void> {
    try {
      await this.supabase.from('rive_bindings_log').insert({
        query,
        binding_site: bindingSite,
        confidence,
        corpus,
        result_id: resultId,
        feedback,
        agent_id: agentId,
      });
    } catch (err) {
      log.warn({ err }, 'Failed to log binding (non-fatal)');
    }
  }

  async createIndexingJob(
    source: string,
    datasetId?: string
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from('rive_indexing_jobs')
      .insert({
        source,
        dataset_id: datasetId || null,
        status: 'queued',
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create indexing job: ${error?.message}`);
    }

    return data.id;
  }

  async updateIndexingJob(
    jobId: string,
    update: {
      status?: string;
      record_count?: number;
      started_at?: string;
      completed_at?: string;
      error_message?: string;
    }
  ): Promise<void> {
    await this.supabase
      .from('rive_indexing_jobs')
      .update(update)
      .eq('id', jobId);
  }

  async loadMetadata(): Promise<Record<string, unknown> | null> {
    try {
      const { data, error } = await this.supabase
        .from('rive_engine_state')
        .select('metadata')
        .eq('id', 'current')
        .single();

      if (error || !data) {
        return null;
      }

      return data.metadata as Record<string, unknown>;
    } catch (err) {
      log.warn({ err }, 'Failed to load metadata (non-fatal)');
      return null;
    }
  }

  getLastSavedAt(): Date | null {
    return this.lastSavedAt;
  }

  invalidateCache(): void {
    this.cachedState = null;
  }
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Dataset } from '@rive-scientific/rive-sdk';
import { createChildLogger } from '../utils/logger.js';
import type { DataSourceId } from '../types.js';

const log = createChildLogger('supabase-adapter');

/**
 * Table name configuration — reads from environment variables.
 * This allows the MCP server to work with any Supabase schema
 * without hardcoding table names.
 */
const TABLE_NAMES = {
  leads: process.env.SUPABASE_TABLE_LEADS || 'leads',
  deals: process.env.SUPABASE_TABLE_DEALS || 'deals',
  properties: process.env.SUPABASE_TABLE_PROPERTIES || 'properties',
  transcripts: process.env.SUPABASE_TABLE_TRANSCRIPTS || 'call_transcripts',
  emails: process.env.SUPABASE_TABLE_EMAILS || 'emails',
};

/**
 * Loads data from Supabase tables and converts to Rive Dataset format.
 */
export class SupabaseDataAdapter {
  private client: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    this.client = createClient(url, key);
    log.info({ tables: TABLE_NAMES }, 'SupabaseDataAdapter initialized with table config');
  }

  async loadDataset(source: DataSourceId): Promise<Dataset> {
    switch (source) {
      case 'supabase_leads':
        return this.loadLeads();
      case 'supabase_deals':
        return this.loadDeals();
      case 'supabase_properties':
        return this.loadProperties();
      case 'transcripts':
        return this.loadTranscripts();
      case 'emails':
        return this.loadEmails();
      default:
        throw new Error(`Unknown Supabase source: ${source}`);
    }
  }

  private async loadLeads(): Promise<Dataset> {
    const tableName = TABLE_NAMES.leads;
    log.info({ table: tableName }, 'Loading leads');

    const { data, error } = await this.client
      .from(tableName)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5000);

    if (error) {
      log.error({ error, table: tableName }, 'Failed to load leads');
      throw error;
    }

    return {
      id: 'supabase_leads',
      name: 'Supabase Leads',
      records: (data || []).map((row: any) => ({
        id: row.id?.toString() || '',
        content: this.flattenToContent(row),
        metadata: {
          table: tableName,
          source: 'supabase',
          ...row,
        },
      })),
    };
  }

  private async loadDeals(): Promise<Dataset> {
    const tableName = TABLE_NAMES.deals;
    log.info({ table: tableName }, 'Loading deals');

    const { data, error } = await this.client
      .from(tableName)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5000);

    if (error) {
      log.error({ error, table: tableName }, 'Failed to load deals');
      throw error;
    }

    return {
      id: 'supabase_deals',
      name: 'Supabase Deals',
      records: (data || []).map((row: any) => ({
        id: row.id?.toString() || '',
        content: this.flattenToContent(row),
        metadata: { table: tableName, source: 'supabase', ...row },
      })),
    };
  }

  private async loadProperties(): Promise<Dataset> {
    const tableName = TABLE_NAMES.properties;
    log.info({ table: tableName }, 'Loading properties');

    const { data, error } = await this.client
      .from(tableName)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5000);

    if (error) {
      log.error({ error, table: tableName }, 'Failed to load properties');
      throw error;
    }

    return {
      id: 'supabase_properties',
      name: 'Supabase Properties',
      records: (data || []).map((row: any) => ({
        id: row.id?.toString() || '',
        content: this.flattenToContent(row),
        metadata: { table: tableName, source: 'supabase', ...row },
      })),
    };
  }

  private async loadTranscripts(): Promise<Dataset> {
    const tableName = TABLE_NAMES.transcripts;
    log.info({ table: tableName }, 'Loading transcripts');

    const { data, error } = await this.client
      .from(tableName)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error) {
      log.error({ error, table: tableName }, 'Failed to load transcripts');
      return { id: 'transcripts', name: 'Call Transcripts', records: [] };
    }

    return {
      id: 'transcripts',
      name: 'Call Transcripts',
      records: (data || []).map((row: any) => ({
        id: row.id?.toString() || '',
        content: row.transcript || row.content || this.flattenToContent(row),
        metadata: { table: tableName, source: 'supabase', ...row },
      })),
    };
  }

  private async loadEmails(): Promise<Dataset> {
    const tableName = TABLE_NAMES.emails;
    log.info({ table: tableName }, 'Loading emails');

    const { data, error } = await this.client
      .from(tableName)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error) {
      log.error({ error, table: tableName }, 'Failed to load emails');
      return { id: 'emails', name: 'Emails', records: [] };
    }

    return {
      id: 'emails',
      name: 'Emails',
      records: (data || []).map((row: any) => ({
        id: row.id?.toString() || '',
        content: [row.subject, row.body, row.from, row.to]
          .filter(Boolean)
          .join(' | '),
        metadata: { table: tableName, source: 'supabase', ...row },
      })),
    };
  }

  /**
   * Flatten any row object into a searchable string.
   */
  private flattenToContent(row: Record<string, any>): string {
    return Object.entries(row)
      .filter(
        ([key, val]) =>
          val != null &&
          typeof val !== 'object' &&
          !['id', 'created_at', 'updated_at'].includes(key)
      )
      .map(([key, val]) => `${key}: ${val}`)
      .join(' | ');
  }
}

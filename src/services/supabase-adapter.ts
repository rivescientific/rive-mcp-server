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
 * Order-by column configuration — some tables use different timestamp columns.
 * Falls back gracefully if the column doesn't exist.
 */
const ORDER_COLUMNS = {
  leads: process.env.SUPABASE_ORDER_LEADS || 'analyzed_at',
  deals: process.env.SUPABASE_ORDER_DEALS || 'created_at',
  properties: process.env.SUPABASE_ORDER_PROPERTIES || 'analyzed_at',
  transcripts: process.env.SUPABASE_ORDER_TRANSCRIPTS || 'created_at',
  emails: process.env.SUPABASE_ORDER_EMAILS || 'created_at',
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
    log.info({ tables: TABLE_NAMES, orderColumns: ORDER_COLUMNS }, 'SupabaseDataAdapter initialized');
  }

  /**
   * Fetch rows from a table with graceful fallback if order column doesn't exist.
   */
  private async fetchRows(
    tableName: string,
    orderColumn: string,
    limit: number
  ): Promise<any[]> {
    // Try with ordering first
    const { data, error } = await this.client
      .from(tableName)
      .select('*')
      .order(orderColumn, { ascending: false })
      .limit(limit);

    if (error) {
      // If ordering column doesn't exist, retry without ordering
      if (error.message?.includes('does not exist') || error.code === '42703') {
        log.warn(
          { table: tableName, column: orderColumn },
          'Order column not found, fetching without ordering'
        );
        const { data: fallbackData, error: fallbackError } = await this.client
          .from(tableName)
          .select('*')
          .limit(limit);

        if (fallbackError) {
          throw fallbackError;
        }
        return fallbackData || [];
      }
      throw error;
    }

    return data || [];
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
    const orderCol = ORDER_COLUMNS.leads;
    log.info({ table: tableName, orderBy: orderCol }, 'Loading leads');

    const rows = await this.fetchRows(tableName, orderCol, 5000);

    return {
      id: 'supabase_leads',
      name: 'Supabase Leads',
      records: rows.map((row: any) => ({
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
    const orderCol = ORDER_COLUMNS.deals;
    log.info({ table: tableName, orderBy: orderCol }, 'Loading deals');

    const rows = await this.fetchRows(tableName, orderCol, 5000);

    return {
      id: 'supabase_deals',
      name: 'Supabase Deals',
      records: rows.map((row: any) => ({
        id: row.id?.toString() || '',
        content: this.flattenToContent(row),
        metadata: { table: tableName, source: 'supabase', ...row },
      })),
    };
  }

  private async loadProperties(): Promise<Dataset> {
    const tableName = TABLE_NAMES.properties;
    const orderCol = ORDER_COLUMNS.properties;
    log.info({ table: tableName, orderBy: orderCol }, 'Loading properties');

    const rows = await this.fetchRows(tableName, orderCol, 5000);

    return {
      id: 'supabase_properties',
      name: 'Supabase Properties',
      records: rows.map((row: any) => ({
        id: row.id?.toString() || '',
        content: this.flattenToContent(row),
        metadata: { table: tableName, source: 'supabase', ...row },
      })),
    };
  }

  private async loadTranscripts(): Promise<Dataset> {
    const tableName = TABLE_NAMES.transcripts;
    const orderCol = ORDER_COLUMNS.transcripts;
    log.info({ table: tableName, orderBy: orderCol }, 'Loading transcripts');

    try {
      const rows = await this.fetchRows(tableName, orderCol, 2000);

      return {
        id: 'transcripts',
        name: 'Call Transcripts',
        records: rows.map((row: any) => ({
          id: row.id?.toString() || '',
          content: row.transcript || row.content || this.flattenToContent(row),
          metadata: { table: tableName, source: 'supabase', ...row },
        })),
      };
    } catch (err) {
      log.error({ err, table: tableName }, 'Failed to load transcripts');
      return { id: 'transcripts', name: 'Call Transcripts', records: [] };
    }
  }

  private async loadEmails(): Promise<Dataset> {
    const tableName = TABLE_NAMES.emails;
    const orderCol = ORDER_COLUMNS.emails;
    log.info({ table: tableName, orderBy: orderCol }, 'Loading emails');

    try {
      const rows = await this.fetchRows(tableName, orderCol, 2000);

      return {
        id: 'emails',
        name: 'Emails',
        records: rows.map((row: any) => ({
          id: row.id?.toString() || '',
          content: [row.subject, row.body, row.from, row.to]
            .filter(Boolean)
            .join(' | '),
          metadata: { table: tableName, source: 'supabase', ...row },
        })),
      };
    } catch (err) {
      log.error({ err, table: tableName }, 'Failed to load emails');
      return { id: 'emails', name: 'Emails', records: [] };
    }
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
          !['id', 'created_at', 'updated_at', 'analyzed_at'].includes(key)
      )
      .map(([key, val]) => `${key}: ${val}`)
      .join(' | ');
  }
}

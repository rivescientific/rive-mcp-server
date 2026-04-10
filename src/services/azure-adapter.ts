/**
 * Azure Data Adapter
 *
 * Implements DataAdapter for Microsoft Azure environments:
 * - Azure SQL Server for structured data (corpora, API keys, engine state)
 * - Azure Blob Storage for document-based corpora (optional)
 *
 * Designed for Payroll Dynamics and similar enterprise deployments
 * where data cannot leave the Azure tenant.
 *
 * Prerequisites:
 *   npm install mssql @azure/storage-blob @azure/identity
 *
 * Environment variables:
 *   AZURE_SQL_SERVER       — SQL Server hostname
 *   AZURE_SQL_DATABASE     — Database name
 *   AZURE_SQL_USER         — SQL auth username (or use managed identity)
 *   AZURE_SQL_PASSWORD     — SQL auth password (or use managed identity)
 *   AZURE_SQL_ENCRYPT      — "true" for Azure-hosted SQL (default: true)
 *   AZURE_USE_MANAGED_IDENTITY — "true" to use Azure AD managed identity
 *   AZURE_BLOB_CONNECTION_STRING — Blob storage connection (optional)
 *   AZURE_BLOB_CONTAINER   — Container name for document corpora (optional)
 */

import type { Dataset } from '@rive-scientific/rive-sdk';
import type { AgentCredentials, AccessLevel } from '../types.js';
import type { DataAdapter, ContentTemplate } from './data-adapter.js';
import { applyContentTemplate } from './data-adapter.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('azure-adapter');

// ── Corpus Configuration ──

export interface AzureCorpusConfig {
  /** Corpus ID used in MCP tool calls */
  id: string;
  /** Human-readable name */
  name: string;
  /** Source type */
  source: 'sql' | 'blob';
  /** For SQL: table or view name */
  table?: string;
  /** For SQL: column to use as record content (default: all columns flattened) */
  contentColumn?: string;
  /** For SQL: column to use as record ID */
  idColumn?: string;
  /** For SQL: ORDER BY column */
  orderColumn?: string;
  /** For SQL: max rows to fetch */
  limit?: number;
  /** For Blob: prefix/folder path */
  blobPrefix?: string;
  /** Content template for PII stripping */
  contentTemplate?: ContentTemplate;
}

// ── Azure Adapter ──

export class AzureDataAdapter implements DataAdapter {
  readonly type = 'azure';

  private sqlPool: any = null;
  private blobClient: any = null;
  private blobContainer: string;
  private corpora: Map<string, AzureCorpusConfig> = new Map();

  constructor(corporaConfigs: AzureCorpusConfig[]) {
    for (const config of corporaConfigs) {
      this.corpora.set(config.id, config);
    }
    this.blobContainer = process.env.AZURE_BLOB_CONTAINER || 'documents';
  }

  async initialize(): Promise<void> {
    // ── SQL Connection ──
    const server = process.env.AZURE_SQL_SERVER;
    const database = process.env.AZURE_SQL_DATABASE;

    if (server && database) {
      try {
        const mssql = await import('mssql');

        const config: any = {
          server,
          database,
          options: {
            encrypt: process.env.AZURE_SQL_ENCRYPT !== 'false',
            trustServerCertificate: process.env.NODE_ENV !== 'production',
          },
        };

        if (process.env.AZURE_USE_MANAGED_IDENTITY === 'true') {
          const { DefaultAzureCredential } = await import('@azure/identity');
          const credential = new DefaultAzureCredential();
          const token = await credential.getToken('https://database.windows.net/');
          config.authentication = {
            type: 'azure-active-directory-access-token',
            options: { token: token.token },
          };
        } else {
          config.user = process.env.AZURE_SQL_USER;
          config.password = process.env.AZURE_SQL_PASSWORD;
        }

        this.sqlPool = await mssql.default.connect(config);
        log.info({ server, database }, 'Azure SQL connected');
      } catch (err) {
        log.error({ err, server, database }, 'Azure SQL connection failed');
        throw err;
      }
    }

    // ── Blob Storage ──
    const blobConnection = process.env.AZURE_BLOB_CONNECTION_STRING;
    if (blobConnection) {
      try {
        const { BlobServiceClient } = await import('@azure/storage-blob');
        this.blobClient = BlobServiceClient.fromConnectionString(blobConnection);
        log.info({ container: this.blobContainer }, 'Azure Blob Storage connected');
      } catch (err) {
        log.error({ err }, 'Azure Blob Storage connection failed');
        throw err;
      }
    }

    if (!this.sqlPool && !this.blobClient) {
      throw new Error(
        'Azure adapter requires at least one of: AZURE_SQL_SERVER + AZURE_SQL_DATABASE, or AZURE_BLOB_CONNECTION_STRING'
      );
    }
  }

  async listCorpora(): Promise<string[]> {
    return Array.from(this.corpora.keys());
  }

  async loadCorpus(corpusId: string): Promise<Dataset> {
    const config = this.corpora.get(corpusId);
    if (!config) {
      throw new Error(`Unknown corpus: ${corpusId}. Available: ${Array.from(this.corpora.keys()).join(', ')}`);
    }

    if (config.source === 'blob') {
      return this.loadBlobCorpus(config);
    }

    return this.loadSqlCorpus(config);
  }

  // ── SQL Corpus Loading ──

  private async loadSqlCorpus(config: AzureCorpusConfig): Promise<Dataset> {
    if (!this.sqlPool) {
      throw new Error('Azure SQL not configured — cannot load SQL corpus');
    }

    const table = config.table || config.id;
    const idCol = config.idColumn || 'id';
    const orderCol = config.orderColumn || 'created_at';
    const limit = config.limit || 5000;

    log.info({ corpus: config.id, table, limit }, 'Loading SQL corpus');

    let query = `SELECT TOP ${limit} * FROM [${table}] ORDER BY [${orderCol}] DESC`;

    try {
      const result = await this.sqlPool.request().query(query);
      const rows: any[] = result.recordset || [];

      return {
        id: config.id,
        name: config.name,
        records: rows.map((row: any) => {
          if (config.contentTemplate) {
            const { indexContent, metadata } = applyContentTemplate(row, config.contentTemplate);
            return {
              id: String(row[idCol] || ''),
              content: indexContent,
              metadata: { table, source: 'azure-sql', ...metadata },
            };
          }

          return {
            id: String(row[idCol] || ''),
            content: config.contentColumn
              ? String(row[config.contentColumn] || '')
              : this.flattenRow(row),
            metadata: { table, source: 'azure-sql', ...row },
          };
        }),
      };
    } catch (err: any) {
      // Fallback: try without ORDER BY if column doesn't exist
      if (err.message?.includes('Invalid column name')) {
        log.warn({ table, orderCol }, 'Order column not found, fetching without ordering');
        const fallbackQuery = `SELECT TOP ${limit} * FROM [${table}]`;
        const result = await this.sqlPool.request().query(fallbackQuery);
        const rows: any[] = result.recordset || [];

        return {
          id: config.id,
          name: config.name,
          records: rows.map((row: any) => {
            if (config.contentTemplate) {
              const { indexContent, metadata } = applyContentTemplate(row, config.contentTemplate);
              return {
                id: String(row[idCol] || ''),
                content: indexContent,
                metadata: { table, source: 'azure-sql', ...metadata },
              };
            }

            return {
              id: String(row[idCol] || ''),
              content: config.contentColumn
                ? String(row[config.contentColumn] || '')
                : this.flattenRow(row),
              metadata: { table, source: 'azure-sql', ...row },
            };
          }),
        };
      }
      throw err;
    }
  }

  // ── Blob Corpus Loading ──

  private async loadBlobCorpus(config: AzureCorpusConfig): Promise<Dataset> {
    if (!this.blobClient) {
      throw new Error('Azure Blob Storage not configured — cannot load blob corpus');
    }

    const container = this.blobClient.getContainerClient(this.blobContainer);
    const prefix = config.blobPrefix || config.id;

    log.info({ corpus: config.id, container: this.blobContainer, prefix }, 'Loading Blob corpus');

    const records: Array<{ id: string; content: string; metadata: Record<string, unknown> }> = [];

    for await (const blob of container.listBlobsFlat({ prefix })) {
      try {
        const blobClient = container.getBlobClient(blob.name);
        const download = await blobClient.download(0);
        const content = await this.streamToString(download.readableStreamBody);

        records.push({
          id: blob.name,
          content,
          metadata: {
            source: 'azure-blob',
            container: this.blobContainer,
            blobName: blob.name,
            lastModified: blob.properties.lastModified?.toISOString(),
            contentLength: blob.properties.contentLength,
          },
        });
      } catch (err) {
        log.warn({ blob: blob.name, err }, 'Failed to read blob, skipping');
      }
    }

    return {
      id: config.id,
      name: config.name,
      records,
    };
  }

  // ── State Persistence ──

  async persistState(stateKey: string, state: unknown): Promise<void> {
    if (!this.sqlPool) {
      log.warn('No SQL pool — state persistence skipped');
      return;
    }

    const json = JSON.stringify(state);
    await this.sqlPool.request()
      .input('key', stateKey)
      .input('value', json)
      .query(`
        MERGE rive_engine_state AS target
        USING (SELECT @key AS state_key) AS source
        ON target.state_key = source.state_key
        WHEN MATCHED THEN UPDATE SET state_value = @value, updated_at = GETUTCDATE()
        WHEN NOT MATCHED THEN INSERT (state_key, state_value, updated_at) VALUES (@key, @value, GETUTCDATE());
      `);
  }

  async loadState(stateKey: string): Promise<unknown | null> {
    if (!this.sqlPool) return null;

    const result = await this.sqlPool.request()
      .input('key', stateKey)
      .query('SELECT state_value FROM rive_engine_state WHERE state_key = @key');

    if (result.recordset?.length > 0) {
      return JSON.parse(result.recordset[0].state_value);
    }
    return null;
  }

  // ── API Key Management ──

  async storeApiKey(
    agentId: string,
    tokenHash: string,
    accessLevel: AccessLevel,
    allowedCorpora: string[],
    allowedTools: string[]
  ): Promise<void> {
    if (!this.sqlPool) throw new Error('Azure SQL required for API key management');

    await this.sqlPool.request()
      .input('agent_id', agentId)
      .input('token_hash', tokenHash)
      .input('access_level', accessLevel)
      .input('allowed_corpora', JSON.stringify(allowedCorpora))
      .input('allowed_tools', JSON.stringify(allowedTools))
      .query(`
        MERGE rive_api_keys AS target
        USING (SELECT @agent_id AS agent_id) AS source
        ON target.agent_id = source.agent_id
        WHEN MATCHED THEN UPDATE SET
          token_hash = @token_hash, access_level = @access_level,
          allowed_corpora = @allowed_corpora, allowed_tools = @allowed_tools
        WHEN NOT MATCHED THEN INSERT
          (agent_id, token_hash, access_level, allowed_corpora, allowed_tools, created_at)
          VALUES (@agent_id, @token_hash, @access_level, @allowed_corpora, @allowed_tools, GETUTCDATE());
      `);
  }

  async validateApiKey(tokenHash: string): Promise<AgentCredentials | null> {
    if (!this.sqlPool) return null;

    const result = await this.sqlPool.request()
      .input('hash', tokenHash)
      .query(`
        SELECT agent_id, access_level, allowed_corpora, allowed_tools, revoked_at
        FROM rive_api_keys WHERE token_hash = @hash
      `);

    if (!result.recordset?.length) return null;
    const row = result.recordset[0];

    if (row.revoked_at) {
      log.warn({ agentId: row.agent_id }, 'Revoked token used');
      return null;
    }

    return {
      agentId: row.agent_id,
      accessLevel: row.access_level as AccessLevel,
      allowedCorpora: JSON.parse(row.allowed_corpora || '[]'),
      allowedTools: JSON.parse(row.allowed_tools || '[]'),
    };
  }

  touchApiKey(tokenHash: string): void {
    if (!this.sqlPool) return;
    this.sqlPool.request()
      .input('hash', tokenHash)
      .query('UPDATE rive_api_keys SET last_used_at = GETUTCDATE() WHERE token_hash = @hash')
      .catch(() => {});
  }

  // ── Utilities ──

  private flattenRow(row: Record<string, any>): string {
    return Object.entries(row)
      .filter(([key, val]) =>
        val != null &&
        typeof val !== 'object' &&
        !['id', 'created_at', 'updated_at'].includes(key)
      )
      .map(([key, val]) => `${key}: ${val}`)
      .join(' | ');
  }

  private async streamToString(stream: any): Promise<string> {
    if (!stream) return '';
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}

// ── SQL Schema Setup ──

/**
 * SQL statements to create required tables in Azure SQL.
 * Run these once during initial setup.
 */
export const AZURE_SQL_SETUP = `
-- API Keys
CREATE TABLE rive_api_keys (
  agent_id        NVARCHAR(255) PRIMARY KEY,
  token_hash      NVARCHAR(255) NOT NULL UNIQUE,
  access_level    NVARCHAR(50) NOT NULL,
  allowed_corpora NVARCHAR(MAX),
  allowed_tools   NVARCHAR(MAX),
  created_at      DATETIME2 DEFAULT GETUTCDATE(),
  last_used_at    DATETIME2,
  revoked_at      DATETIME2
);

-- Engine State
CREATE TABLE rive_engine_state (
  state_key       NVARCHAR(255) PRIMARY KEY,
  state_value     NVARCHAR(MAX) NOT NULL,
  updated_at      DATETIME2 DEFAULT GETUTCDATE()
);
`;

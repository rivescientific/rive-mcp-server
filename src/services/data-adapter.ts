/**
 * Generic Data Adapter Interface
 *
 * Abstracts the data plane so the MCP server can work with any backend:
 * Supabase, Azure SQL, Azure Blob, flat files, etc.
 *
 * Implementations must provide:
 * - loadCorpus(): Load a named corpus into Rive Dataset format
 * - listCorpora(): List available corpus IDs
 * - persistState(): Save engine state
 * - loadState(): Restore engine state
 * - storeApiKey() / validateApiKey(): Auth key management
 */

import type { Dataset } from '@rive-scientific/rive-sdk';
import type { AgentCredentials, AccessLevel } from '../types.js';

// ── Content Template (PII Stripping) ──

export interface FieldRule {
  /** Include in the search index (tokenized by Rive) */
  index: boolean;
  /** Include in metadata (returned with results but not tokenized) */
  metadata: boolean;
}

export interface ContentTemplate {
  /** Template ID (e.g., 'payroll_safe') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Field rules: field name → what to do with it */
  fields: Record<string, FieldRule>;
  /** Fields matching these patterns are always dropped (never indexed, never in metadata) */
  dropPatterns: RegExp[];
}

/**
 * Default payroll-safe content template.
 * Strips SSN, bank routing, account numbers, and raw compensation
 * before anything reaches the tokenizer.
 */
export const PAYROLL_SAFE_TEMPLATE: ContentTemplate = {
  id: 'payroll_safe',
  name: 'Payroll Safe — PII Stripped',
  fields: {
    // Always drop
    ssn: { index: false, metadata: false },
    social_security: { index: false, metadata: false },
    social_security_number: { index: false, metadata: false },
    bank_routing: { index: false, metadata: false },
    routing_number: { index: false, metadata: false },
    account_number: { index: false, metadata: false },
    bank_account: { index: false, metadata: false },
    salary: { index: false, metadata: false },
    wage: { index: false, metadata: false },
    compensation: { index: false, metadata: false },
    net_pay: { index: false, metadata: false },
    gross_pay: { index: false, metadata: false },
    direct_deposit: { index: false, metadata: false },

    // Metadata only (not tokenized)
    employee_name: { index: false, metadata: true },
    employee_id: { index: false, metadata: true },
    date_of_birth: { index: false, metadata: true },
    address: { index: false, metadata: true },
    phone: { index: false, metadata: true },
    email: { index: false, metadata: true },
  },
  dropPatterns: [
    /\b\d{3}-\d{2}-\d{4}\b/,       // SSN format
    /\b\d{9}\b/,                     // 9-digit numbers (SSN without dashes)
    /\b\d{8,17}\b/,                  // Bank account numbers
    /\bABA\s*\d{9}\b/i,             // ABA routing numbers
  ],
};

// ── Data Adapter Interface ──

export interface DataAdapterConfig {
  /** Adapter type identifier */
  type: string;
  /** Connection-specific config (varies by adapter) */
  connection: Record<string, unknown>;
  /** Content template for PII stripping (optional) */
  contentTemplate?: ContentTemplate;
}

export interface DataAdapter {
  /** Adapter type identifier */
  readonly type: string;

  /**
   * Initialize the adapter (connect, verify access, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Load a named corpus into Rive Dataset format.
   * If a content template is configured, fields are filtered before returning.
   */
  loadCorpus(corpusId: string): Promise<Dataset>;

  /**
   * List all available corpus IDs this adapter can serve.
   */
  listCorpora(): Promise<string[]>;

  /**
   * Persist engine state for durability.
   */
  persistState(stateKey: string, state: unknown): Promise<void>;

  /**
   * Load persisted engine state.
   */
  loadState(stateKey: string): Promise<unknown | null>;

  /**
   * Store an API key hash with agent credentials.
   */
  storeApiKey(
    agentId: string,
    tokenHash: string,
    accessLevel: AccessLevel,
    allowedCorpora: string[],
    allowedTools: string[]
  ): Promise<void>;

  /**
   * Validate a token hash and return agent credentials, or null if invalid/revoked.
   */
  validateApiKey(tokenHash: string): Promise<AgentCredentials | null>;

  /**
   * Record last-used timestamp for a token (fire-and-forget).
   */
  touchApiKey(tokenHash: string): void;
}

// ── Content Template Utilities ──

/**
 * Apply a content template to a raw record.
 * Returns { indexContent, metadata } with PII stripped.
 */
export function applyContentTemplate(
  row: Record<string, unknown>,
  template: ContentTemplate
): { indexContent: string; metadata: Record<string, unknown> } {
  const indexParts: string[] = [];
  const metadata: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (value == null) continue;

    const strVal = String(value);
    const rule = template.fields[key.toLowerCase()];

    // Explicit rule exists
    if (rule) {
      if (rule.index) {
        const cleaned = stripPatterns(strVal, template.dropPatterns);
        if (cleaned.trim()) indexParts.push(`${key}: ${cleaned}`);
      }
      if (rule.metadata) {
        metadata[key] = value;
      }
      // If both are false, the field is dropped entirely
      continue;
    }

    // No explicit rule — default: index + metadata, but strip patterns
    const cleaned = stripPatterns(strVal, template.dropPatterns);
    if (cleaned.trim()) indexParts.push(`${key}: ${cleaned}`);
    metadata[key] = value;
  }

  return {
    indexContent: indexParts.join(' | '),
    metadata,
  };
}

function stripPatterns(text: string, patterns: RegExp[]): string {
  let result = text;
  for (const pattern of patterns) {
    result = result.replace(new RegExp(pattern, 'g'), '[REDACTED]');
  }
  return result;
}

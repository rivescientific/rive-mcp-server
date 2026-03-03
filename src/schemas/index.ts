import { z } from 'zod';

const dataSourceEnum = z.enum([
  'supabase_leads',
  'supabase_deals',
  'supabase_properties',
  'zoho_crm',
  'transcripts',
  'emails',
]);

// ── rive_search ──
export const SearchInputSchema = z.object({
  corpus: z
    .array(dataSourceEnum)
    .min(1, 'At least one corpus required')
    .describe(
      "Datasets to search: 'supabase_leads', 'supabase_deals', 'supabase_properties', 'zoho_crm', 'transcripts', 'emails'"
    ),
  query: z
    .string()
    .min(3, 'Query must be at least 3 characters')
    .max(1000, 'Query max 1000 chars')
    .describe(
      "Natural language query (e.g., 'Find high-value leads in Fort Lauderdale with 20+ properties')"
    ),
  mode: z
    .enum(['streaming', 'refinement', 'semantic'])
    .default('semantic')
    .describe(
      "Search mode: 'streaming' for speed, 'refinement' for accuracy, 'semantic' for LLM-enhanced"
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Max results to return'),
  immunity_check: z
    .boolean()
    .default(true)
    .describe('Enable Farnsworth immunity check on results'),
});

// ── rive_discover_bridges ──
export const BridgesInputSchema = z.object({
  corpus: z
    .array(dataSourceEnum)
    .min(2, 'Need at least 2 corpora for bridge discovery')
    .describe('Datasets to discover bridges between'),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.7)
    .describe('Confidence threshold for bridge discovery (0-1)'),
  max_bridges: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Maximum bridges to return'),
});

// ── rive_learn ──
export const LearnInputSchema = z.object({
  query: z.string().describe('Original query that produced the result'),
  result_id: z.string().describe('ID of the search result'),
  corpus: z.array(dataSourceEnum).describe('Corpora that produced the result'),
  feedback: z
    .enum(['positive', 'negative', 'partial'])
    .default('positive')
    .describe('Quality feedback on the result'),
  notes: z
    .string()
    .optional()
    .describe('Optional notes on why this result worked or failed'),
});

// ── rive_assess_immunity ──
export const ImmunityInputSchema = z.object({
  query: z.string().describe('Query to assess for anomalies'),
  corpus: z.array(dataSourceEnum).describe('Corpora to check against'),
  threat_types: z
    .array(
      z.enum([
        'FALSE_POSITIVE_BRIDGE',
        'STRUCTURAL_MISLEAD',
        'ADVERSARIAL_QUERY',
        'POISONED_NODE',
        'STALE_BRIDGE',
      ])
    )
    .optional()
    .describe('Specific threat types to check for (default: all)'),
});

// ── rive_diagnose_stress ──
export const StressInputSchema = z.object({
  query: z.string().describe('Query to diagnose'),
  corpus: z.array(dataSourceEnum).describe('Corpora to check against'),
});

// ── rive_index_dataset ──
export const IndexDatasetInputSchema = z.object({
  source: dataSourceEnum.describe('Data source to index'),
  dataset_id: z
    .string()
    .optional()
    .describe('Optional specific dataset ID to reindex'),
  force_refresh: z
    .boolean()
    .default(false)
    .describe('Force full re-index even if data unchanged'),
});

// ── rive_get_state ──
export const GetStateInputSchema = z.object({
  summary_only: z
    .boolean()
    .default(true)
    .describe('Return summary stats vs detailed state'),
});

// ── rive_set_state ──
export const SetStateInputSchema = z.object({
  state_json: z
    .string()
    .describe('Serialized engine state JSON to restore'),
  reason: z
    .string()
    .optional()
    .describe('Why the state is being restored'),
});

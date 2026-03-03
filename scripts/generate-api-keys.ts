/**
 * Generate API keys for all 7 agents.
 * Run this once after deploying the server:
 *   npx tsx scripts/generate-api-keys.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface AgentDef {
  id: string;
  accessLevel: string;
  allowedCorpora: string[];
  allowedTools: string[];
}

const agents: AgentDef[] = [
  {
    id: 'acquisitions_analyst',
    accessLevel: 'HIGH',
    allowedCorpora: ['supabase_leads', 'supabase_deals', 'supabase_properties', 'zoho_crm', 'transcripts', 'emails'],
    allowedTools: ['rive_search', 'rive_discover_bridges', 'rive_learn', 'rive_assess_immunity', 'rive_diagnose_stress', 'rive_get_state', 'rive_index_dataset'],
  },
  {
    id: 'lead_qualifier',
    accessLevel: 'MEDIUM',
    allowedCorpora: ['supabase_leads', 'transcripts'],
    allowedTools: ['rive_search', 'rive_assess_immunity', 'rive_learn'],
  },
  {
    id: 'deal_underwriter',
    accessLevel: 'HIGH',
    allowedCorpora: ['supabase_deals', 'supabase_properties', 'emails', 'transcripts'],
    allowedTools: ['rive_search', 'rive_discover_bridges', 'rive_learn', 'rive_assess_immunity', 'rive_get_state'],
  },
  {
    id: 'dispositions_coordinator',
    accessLevel: 'MEDIUM',
    allowedCorpora: ['supabase_deals', 'supabase_properties', 'supabase_leads'],
    allowedTools: ['rive_search', 'rive_discover_bridges', 'rive_learn'],
  },
  {
    id: 'marketing_agent',
    accessLevel: 'READ_MOSTLY',
    allowedCorpora: ['supabase_properties', 'supabase_deals'],
    allowedTools: ['rive_search', 'rive_learn'],
  },
  {
    id: 'compliance_docs',
    accessLevel: 'HIGH',
    allowedCorpora: ['supabase_deals', 'supabase_properties', 'emails', 'zoho_crm'],
    allowedTools: ['rive_search', 'rive_assess_immunity'],
  },
  {
    id: 'mary_ai_coordinator',
    accessLevel: 'MEDIUM',
    allowedCorpora: ['transcripts', 'supabase_leads'],
    allowedTools: ['rive_search', 'rive_learn'],
  },
];

async function generateKey(agent: AgentDef): Promise<string> {
  const raw = `abundance-re-${agent.id}-${Date.now()}-${Math.random()}`;
  const token = `sk-rive-${createHash('sha256').update(raw).digest('hex').slice(0, 48)}`;
  const hash = createHash('sha256').update(token).digest('hex');

  const { error } = await supabase.from('rive_api_keys').upsert({
    agent_id: agent.id,
    token_hash: hash,
    access_level: agent.accessLevel,
    allowed_corpora: agent.allowedCorpora,
    allowed_tools: agent.allowedTools,
  });

  if (error) {
    throw new Error(`Failed for ${agent.id}: ${error.message}`);
  }

  return token;
}

async function main() {
  console.log('Generating API keys for all agents...\n');

  const keys: Record<string, string> = {};

  for (const agent of agents) {
    const token = await generateKey(agent);
    keys[agent.id] = token;
    console.log(`${agent.id} (${agent.accessLevel}): ${token}`);
  }

  console.log('\n--- OpenClaw .env format ---\n');
  for (const [id, token] of Object.entries(keys)) {
    console.log(`RIVE_MCP_KEY_${id.toUpperCase()}=${token}`);
  }

  console.log('\nDone! Store these keys securely. They cannot be retrieved later.');
}

main().catch(console.error);

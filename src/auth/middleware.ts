import { createHash } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createChildLogger } from '../utils/logger.js';
import type { AgentCredentials, AccessLevel } from '../types.js';

const log = createChildLogger('auth');

let supabase: SupabaseClient;

export function initAuth() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  supabase = createClient(url, key);
  log.info('Auth module initialized');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Validate a bearer token and return agent credentials.
 * Returns null if the token is invalid or revoked.
 */
export async function validateToken(
  token: string
): Promise<AgentCredentials | null> {
  const hash = hashToken(token);

  const { data, error } = await supabase
    .from('rive_api_keys')
    .select('agent_id, access_level, allowed_corpora, allowed_tools, revoked_at')
    .eq('token_hash', hash)
    .single();

  if (error || !data) {
    log.warn({ error }, 'Token validation failed');
    return null;
  }

  if (data.revoked_at) {
    log.warn({ agentId: data.agent_id }, 'Revoked token used');
    return null;
  }

  // Update last_used_at (fire-and-forget)
  supabase
    .from('rive_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', hash)
    .then(() => {});

  return {
    agentId: data.agent_id,
    accessLevel: data.access_level as AccessLevel,
    allowedCorpora: data.allowed_corpora || [],
    allowedTools: data.allowed_tools || [],
  };
}

/**
 * Generate a new API key for an agent and store its hash.
 */
export async function generateApiKey(
  agentId: string,
  accessLevel: AccessLevel,
  allowedCorpora: string[],
  allowedTools: string[]
): Promise<string> {
  const seed = process.env.API_KEY_SEED || 'default-seed';
  const raw = `${seed}-${agentId}-${Date.now()}-${Math.random()}`;
  const token = `sk-rive-${createHash('sha256').update(raw).digest('hex').slice(0, 48)}`;
  const hash = hashToken(token);

  const { error } = await supabase.from('rive_api_keys').upsert({
    agent_id: agentId,
    token_hash: hash,
    access_level: accessLevel,
    allowed_corpora: allowedCorpora,
    allowed_tools: allowedTools,
  });

  if (error) {
    log.error({ error, agentId }, 'Failed to store API key');
    throw new Error(`Failed to generate API key: ${error.message}`);
  }

  log.info({ agentId, accessLevel }, 'API key generated');
  return token;
}

/**
 * Extract bearer token from an Authorization header.
 */
export function extractBearerToken(
  authHeader: string | undefined
): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7).trim();
}

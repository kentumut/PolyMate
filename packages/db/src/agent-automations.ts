import type { OwnerContext } from '@polymate/core/identity';
import { getPool } from './connection';
import { ensureUser } from './google-oauth';

export type AutomationRegistrationRow = {
  id: string; key: string; gatewayJobId: string; name: string; ownerId: string; allowedTools: string[];
};

export async function saveAutomationRegistration(owner: OwnerContext, input: {
  key: string; gatewayJobId: string; name: string; allowedTools: readonly string[];
}): Promise<AutomationRegistrationRow> {
  await ensureUser(owner);
  const result = await getPool().query<{ id: string; owner_id: string; registration_key: string; gateway_job_id: string; display_name: string; allowed_tools: string[] }>(
    `INSERT INTO agent_automation_registrations (owner_id, registration_key, gateway_job_id, display_name, allowed_tools)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (owner_id, registration_key) DO NOTHING
     RETURNING id, owner_id, registration_key, gateway_job_id, display_name, allowed_tools`,
    [owner.userId, input.key, input.gatewayJobId, input.name, [...input.allowedTools]],
  );
  const row = result.rows[0];
  if (!row) throw new Error('This automation is already registered for the student.');
  return { id: row.id, ownerId: row.owner_id, key: row.registration_key, gatewayJobId: row.gateway_job_id, name: row.display_name, allowedTools: row.allowed_tools };
}

export async function findAutomationRegistration(ownerId: string, id: string): Promise<AutomationRegistrationRow | null> {
  const result = await getPool().query<{ id: string; owner_id: string; registration_key: string; gateway_job_id: string; display_name: string; allowed_tools: string[] }>(
    `SELECT id, owner_id, registration_key, gateway_job_id, display_name, allowed_tools
     FROM agent_automation_registrations WHERE owner_id = $1 AND id = $2`, [ownerId, id],
  );
  const row = result.rows[0];
  return row ? { id: row.id, ownerId: row.owner_id, key: row.registration_key, gatewayJobId: row.gateway_job_id, name: row.display_name, allowedTools: row.allowed_tools } : null;
}

export async function findAutomationForGatewayJob(gatewayJobId: string): Promise<AutomationRegistrationRow | null> {
  const result = await getPool().query<{ id: string; owner_id: string; registration_key: string; gateway_job_id: string; display_name: string; allowed_tools: string[] }>(
    `SELECT id, owner_id, registration_key, gateway_job_id, display_name, allowed_tools
     FROM agent_automation_registrations WHERE gateway_job_id = $1`, [gatewayJobId],
  );
  const row = result.rows[0];
  return row ? { id: row.id, ownerId: row.owner_id, key: row.registration_key, gatewayJobId: row.gateway_job_id, name: row.display_name, allowedTools: row.allowed_tools } : null;
}

export async function deleteAutomationRegistration(ownerId: string, id: string): Promise<void> {
  await getPool().query('DELETE FROM agent_automation_registrations WHERE owner_id = $1 AND id = $2', [ownerId, id]);
}

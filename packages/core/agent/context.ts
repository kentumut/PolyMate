import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

const OWNER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTEXT_KEY = /^pm\.([0-9a-f-]{36})\.([0-9a-f-]{36})\.([a-f0-9]{64})$/i;

function contextSecret(secret: string | undefined): string {
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('AGENT_CONTEXT_SECRET must contain at least 32 bytes.');
  return secret;
}

function signature(ownerId: string, turnId: string, secret: string): string {
  return createHmac('sha256', secret).update(`polymate-agent-session:v2:${ownerId.toLowerCase()}:${turnId}`).digest('hex');
}

/** A fresh signed run claim prevents callbacks from an expired turn authorizing a later turn. */
export function agentSessionKey(ownerId: string, secret = process.env.AGENT_CONTEXT_SECRET): string {
  if (!OWNER_ID.test(ownerId)) throw new Error('Agent owner id is invalid.');
  const key = contextSecret(secret);
  const owner = ownerId.toLowerCase();
  const turnId = randomUUID();
  return `pm.${owner}.${turnId}.${signature(owner, turnId, key)}`;
}

/** OpenClaw may prefix the application user value with its agent/session namespace. */
export function ownerIdFromAgentSessionKey(value: string, secret = process.env.AGENT_CONTEXT_SECRET): string {
  if (typeof value !== 'string' || value.length > 512) throw new Error('Agent session is invalid.');
  const candidate = value.split(':').at(-1) ?? '';
  const match = CONTEXT_KEY.exec(candidate);
  if (!match || !OWNER_ID.test(match[1]) || !OWNER_ID.test(match[2])) throw new Error('Agent session is not authorized.');
  const ownerId = match[1].toLowerCase();
  const expected = Buffer.from(signature(ownerId, match[2], contextSecret(secret)), 'hex');
  const actual = Buffer.from(match[3].toLowerCase(), 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Agent session is not authorized.');
  return ownerId;
}

export type OpenClawToolEnvelope = Readonly<{
  sessionKey: string;
  name: string;
  arguments: Record<string, unknown>;
}>;

export function signOpenClawToolEnvelope(rawBody: string, timestamp: string, nonce: string, secret: string): string {
  return createHmac('sha256', contextSecret(secret)).update(`${timestamp}\n${nonce}\n${rawBody}`).digest('hex');
}

export function verifyOpenClawToolEnvelope(input: {
  rawBody: string;
  timestamp: string | null;
  nonce: string | null;
  suppliedSignature: string | null;
  secret: string | undefined;
  now?: number;
}): boolean {
  if (!input.timestamp || !/^\d{10,13}$/.test(input.timestamp) || !input.nonce || !/^[a-f0-9-]{16,64}$/i.test(input.nonce) ||
      !input.suppliedSignature || !/^[a-f0-9]{64}$/i.test(input.suppliedSignature)) return false;
  let key: string;
  try { key = contextSecret(input.secret); } catch { return false; }
  const timestamp = Number(input.timestamp);
  const now = input.now ?? Date.now();
  const sentAt = input.timestamp.length === 10 ? timestamp * 1000 : timestamp;
  if (!Number.isSafeInteger(sentAt) || Math.abs(now - sentAt) > 30_000) return false;
  const expected = Buffer.from(signOpenClawToolEnvelope(input.rawBody, input.timestamp, input.nonce, key), 'hex');
  const supplied = Buffer.from(input.suppliedSignature, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function parseOpenClawToolEnvelope(value: unknown): OpenClawToolEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid tool request.');
  const body = value as Record<string, unknown>;
  if (typeof body.sessionKey !== 'string' || typeof body.name !== 'string' || !body.arguments ||
      typeof body.arguments !== 'object' || Array.isArray(body.arguments) || Object.keys(body).some(key => !['sessionKey', 'name', 'arguments'].includes(key))) {
    throw new Error('Invalid tool request.');
  }
  return { sessionKey: body.sessionKey, name: body.name, arguments: body.arguments as Record<string, unknown> };
}

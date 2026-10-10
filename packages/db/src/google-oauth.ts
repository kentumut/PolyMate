import type { OwnerContext } from '@polymate/core/identity';
import type { OAuthStateStore } from '@polymate/core/google-auth';
import { refreshAccessToken } from '@polymate/core/google-auth';
import { decryptSecret, encryptSecret } from '@polymate/core/google-auth/crypto';
import type { CalendarHome } from '@polymate/core/calendar/home';
import { getPool } from './connection';
import { calendarOperationSessionClient } from './calendar-operations';

export async function ensureUser(owner: OwnerContext): Promise<void> {
  const result = await (calendarOperationSessionClient() ?? getPool()).query(
    `INSERT INTO users (id, external_identity, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE
     SET display_name = EXCLUDED.display_name, updated_at = now()
     WHERE users.external_identity = EXCLUDED.external_identity`,
    [owner.userId, owner.externalId, owner.displayName],
  );
  if (result.rowCount !== 1) throw new Error('Managed identity does not match the stored user.');
}

export const oauthStateStore: OAuthStateStore = {
  async create({ ownerId, stateHash, browserBindingHash, expiresAt }) {
    await getPool().query(
      `INSERT INTO oauth_states (owner_id, state_hash, browser_binding_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [ownerId, stateHash, browserBindingHash, expiresAt],
    );
  },
  async consume({ stateHash, browserBindingHash, now }) {
    const result = await getPool().query<{ owner_id: string }>(
      `UPDATE oauth_states SET consumed_at = $3
       WHERE state_hash = $1 AND browser_binding_hash = $2
         AND consumed_at IS NULL AND expires_at > $3
       RETURNING owner_id`,
      [stateHash, browserBindingHash, now],
    );
    return result.rows[0]?.owner_id ?? null;
  },
};

export async function getConnectionStatus(ownerId: string): Promise<{ connected: boolean; calendarHome: CalendarHome }> {
  const result = await (calendarOperationSessionClient() ?? getPool()).query<{ connected: boolean; calendar_home: CalendarHome }>(
    `SELECT (refresh_token_ciphertext IS NOT NULL OR access_token_expires_at > now()) AS connected, calendar_home
     FROM calendar_connections WHERE owner_id = $1`,
    [ownerId],
  );
  // The home stays 'google' while a stored token is expired: blocks never silently move to PolyMate.
  return { connected: result.rows[0]?.connected ?? false, calendarHome: result.rows[0]?.calendar_home ?? 'polymate' };
}

/** Google can be chosen only while a connection row exists; switching back never needs one. */
export async function setCalendarHome(ownerId: string, home: CalendarHome): Promise<void> {
  const result = await (calendarOperationSessionClient() ?? getPool()).query(
    'UPDATE calendar_connections SET calendar_home = $2, updated_at = now() WHERE owner_id = $1', [ownerId, home],
  );
  if (home === 'google' && result.rowCount !== 1) throw new Error('Google Calendar is not connected.');
}

/** Returns `created: true` only for a first connection, so callers can apply first-connect defaults. */
export async function saveConnection(ownerId: string, tokens: {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}): Promise<{ created: boolean }> {
  if (!tokens.refreshToken) {
    const existing = await getPool().query<{ refresh_token_ciphertext: string | null }>(
      'SELECT refresh_token_ciphertext FROM calendar_connections WHERE owner_id = $1', [ownerId],
    );
    if (!existing.rows[0]?.refresh_token_ciphertext) {
      throw new Error('Google did not provide offline access. Please reconnect.');
    }
  }
  const result = await getPool().query<{ created: boolean }>(
    `INSERT INTO calendar_connections
       (owner_id, access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at, granted_scopes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (owner_id) DO UPDATE SET
       access_token_ciphertext = EXCLUDED.access_token_ciphertext,
       refresh_token_ciphertext = COALESCE(EXCLUDED.refresh_token_ciphertext, calendar_connections.refresh_token_ciphertext),
       access_token_expires_at = EXCLUDED.access_token_expires_at,
       granted_scopes = EXCLUDED.granted_scopes,
       connected_at = now(), updated_at = now()
     RETURNING (xmax = 0) AS created`,
    [ownerId, encryptSecret(tokens.accessToken), tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null, tokens.expiresAt, tokens.scopes],
  );
  return { created: result.rows[0]?.created ?? false };
}

/** Study blocks still live in Google; disconnecting would hide them from PolyMate. */
export class CalendarHomeInUseError extends Error {
  constructor() {
    super('Your study blocks are saved in Google Calendar. Move them to the PolyMate calendar before disconnecting Google.');
    this.name = 'CalendarHomeInUseError';
  }
}

export async function disconnectGoogle(ownerId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM oauth_states WHERE owner_id = $1', [ownerId]);
    const removed = await client.query("DELETE FROM calendar_connections WHERE owner_id = $1 AND calendar_home = 'polymate'", [ownerId]);
    if (!removed.rowCount) {
      const kept = await client.query('SELECT 1 FROM calendar_connections WHERE owner_id = $1', [ownerId]);
      if (kept.rowCount) throw new CalendarHomeInUseError();
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getValidAccessToken(owner: Pick<OwnerContext, 'userId'>): Promise<string> {
  const result = await getPool().query<{
    access_token_ciphertext: string | null;
    refresh_token_ciphertext: string | null;
    access_token_expires_at: Date | null;
  }>(
    `SELECT access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at
     FROM calendar_connections WHERE owner_id = $1`,
    [owner.userId],
  );
  const connection = result.rows[0];
  if (!connection) throw new Error('Google Calendar is not connected.');
  if (connection.access_token_ciphertext && connection.access_token_expires_at &&
      connection.access_token_expires_at.getTime() > Date.now() + 60_000) {
    return decryptSecret(connection.access_token_ciphertext);
  }
  if (!connection.refresh_token_ciphertext) throw new Error('Google Calendar must be reconnected.');
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google OAuth is not configured.');
  const refreshed = await refreshAccessToken({
    refreshToken: decryptSecret(connection.refresh_token_ciphertext), clientId, clientSecret,
  });
  const update = await getPool().query(
    `UPDATE calendar_connections SET access_token_ciphertext = $2,
       access_token_expires_at = $3, granted_scopes = COALESCE($4, granted_scopes), updated_at = now()
     WHERE owner_id = $1 AND refresh_token_ciphertext = $5`,
    [owner.userId, encryptSecret(refreshed.accessToken), refreshed.expiresAt,
      refreshed.scopes ?? null, connection.refresh_token_ciphertext],
  );
  if (!update.rowCount) throw new Error('Google connection changed during refresh; retry.');
  return refreshed.accessToken;
}

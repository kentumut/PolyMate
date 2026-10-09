import { randomToken, sha256 } from "./crypto";

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar.events.owned"] as const;
const STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthStateStore {
  create(input: { ownerId: string; stateHash: Buffer; browserBindingHash: Buffer; expiresAt: Date }): Promise<void>;
  consume(input: { stateHash: Buffer; browserBindingHash: Buffer; now: Date }): Promise<string | null>;
}

export interface OAuthConfig {
  clientId: string;
  redirectUri: string;
}

export async function createAuthorization(input: {
  ownerId: string;
  browserBinding: string;
  store: OAuthStateStore;
  config: OAuthConfig;
  now?: Date;
}): Promise<{ url: string; browserBinding: string }> {
  const state = randomToken();
  const browserBinding = input.browserBinding || randomToken();
  const now = input.now ?? new Date();
  await input.store.create({
    ownerId: input.ownerId,
    stateHash: sha256(state),
    browserBindingHash: sha256(browserBinding),
    expiresAt: new Date(now.getTime() + STATE_TTL_MS),
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: input.config.clientId,
    redirect_uri: input.config.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return { url: url.toString(), browserBinding };
}

export async function consumeCallbackState(input: {
  state: string;
  browserBinding: string;
  store: OAuthStateStore;
  now?: Date;
}): Promise<string> {
  if (!input.state || !input.browserBinding) throw new Error("Invalid OAuth state");
  const ownerId = await input.store.consume({
    stateHash: sha256(input.state),
    browserBindingHash: sha256(input.browserBinding),
    now: input.now ?? new Date(),
  });
  if (!ownerId) throw new Error("Invalid, expired, or already used OAuth state");
  return ownerId;
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetcher?: typeof fetch;
}): Promise<{ accessToken: string; refreshToken?: string; expiresAt: Date; scopes: string[] }> {
  const response = await (input.fetcher ?? fetch)("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
    throw new Error("Google authorization code exchange failed");
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    expiresAt: new Date(Date.now() + body.expires_in * 1000),
    scopes: typeof body.scope === "string" ? body.scope.split(" ").filter(Boolean) : [],
  };
}

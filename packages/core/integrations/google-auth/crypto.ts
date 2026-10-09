import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";

function keyFromEnv(): Buffer {
  const encoded = process.env.TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("TOKEN_ENCRYPTION_KEY is required");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromEnv(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(value: string): string {
  const [version, ivText, tagText, bodyText, ...extra] = value.split(".");
  if (version !== VERSION || !ivText || !tagText || !bodyText || extra.length) throw new Error("Unsupported encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", keyFromEnv(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(bodyText, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function stateSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("OAUTH_STATE_SECRET must contain at least 32 bytes");
  return secret;
}

export function sealBrowserBinding(binding: string): string {
  const signature = createHmac("sha256", stateSecret()).update(binding).digest("base64url");
  return `${binding}.${signature}`;
}

export function openBrowserBinding(sealed: string): string | null {
  const [binding, signature, extra] = sealed.split(".");
  if (!binding || !signature || extra) return null;
  const expected = createHmac("sha256", stateSecret()).update(binding).digest("base64url");
  return constantTimeEqual(signature, expected) ? binding : null;
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

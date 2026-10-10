import { createHmac, randomUUID } from 'node:crypto';

export function signedRequestBody(sessionKey, name, args, secret, now = Date.now(), nonce = randomUUID()) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw new Error('PolyMate agent bridge is not configured.');
  const timestamp = String(now);
  const rawBody = JSON.stringify({ sessionKey, name, arguments: args });
  const signature = createHmac('sha256', secret).update(`${timestamp}\n${nonce}\n${rawBody}`).digest('hex');
  return { rawBody, timestamp, nonce, signature };
}

export async function invokePolyMateTool({ toolUrl, bridgeSecret, sessionKey, name, args, signal, fetchImpl = fetch }) {
  if (!toolUrl || !bridgeSecret || !sessionKey) throw new Error('PolyMate tools are not configured for this OpenClaw session.');
  let endpoint;
  try { endpoint = new URL(toolUrl); } catch { throw new Error('PolyMate agent tool URL is invalid.'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('PolyMate agent tool URL is invalid.');
  }
  const signed = signedRequestBody(sessionKey, name, args, bridgeSecret);
  const callbackSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(85_000)]) : AbortSignal.timeout(85_000);
  const response = await fetchImpl(endpoint, {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: callbackSignal,
    headers: {
      'Content-Type': 'application/json',
      'x-polymate-timestamp': signed.timestamp,
      'x-polymate-nonce': signed.nonce,
      'x-polymate-signature': signed.signature,
    },
    body: signed.rawBody,
  }).catch(() => { throw new Error('PolyMate could not be reached for this tool call.'); });
  let result;
  try {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    let size = 0;
    if (!reader) throw new Error();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 900_000) { await reader.cancel(); throw new Error(); }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      result = JSON.parse(raw + decoder.decode());
    } finally { reader.releaseLock(); }
  } catch { throw new Error('PolyMate returned an oversized or unreadable tool result.'); }
  if (!response.ok) {
    const message = typeof result?.error?.message === 'string' ? result.error.message : 'PolyMate could not complete this tool call.';
    throw new Error(message.slice(0, 500));
  }
  return result;
}

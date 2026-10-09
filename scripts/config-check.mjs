export function validateConfiguration(env) {
  const errors = [];
  if (env.AUTH_MODE !== 'managed-proxy') errors.push('Production AUTH_MODE must be managed-proxy.');
  if (env.MANAGED_PROXY_ONLY !== 'true') errors.push('Confirm proxy-only ingress with MANAGED_PROXY_ONLY=true.');
  try {
    const origin = new URL(env.APP_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== env.APP_ORIGIN) throw new Error();
  } catch { errors.push('APP_ORIGIN must be a canonical HTTPS origin.'); }
  if (!/^[A-Za-z0-9_-]{24,}$/.test(env.POSTGRES_PASSWORD ?? '') || /replace|example|change/i.test(env.POSTGRES_PASSWORD ?? '')) {
    errors.push('Generate a database password with at least 24 URL-safe characters.');
  }
  for (const key of ['POSTGRES_USER', 'POSTGRES_DB']) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(env[key] ?? 'polymate')) errors.push(`${key} must be a simple SQL identifier.`);
  }
  if (env.GOOGLE_ENABLED === 'true') {
    for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TOKEN_ENCRYPTION_KEY', 'OAUTH_STATE_SECRET']) {
      if (!env[key]) errors.push(`${key} is required when GOOGLE_ENABLED=true.`);
    }
    if (env.GOOGLE_REDIRECT_URI !== `${env.APP_ORIGIN}/api/integrations/google/callback`) {
      errors.push('GOOGLE_REDIRECT_URI must match the managed application origin.');
    }
  }
  return errors;
}

if (process.argv[1]?.endsWith('/config-check.mjs')) {
  const errors = validateConfiguration(process.env);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('Production configuration checks passed. Secret values were not printed.');
}

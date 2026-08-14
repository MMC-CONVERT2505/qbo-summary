import 'dotenv/config';

const env = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === '') {
    if (fallback === undefined) throw new Error(`Missing required env var: ${key}`);
    return fallback;
  }
  return v;
};

const isProduction = process.env.NODE_ENV === 'production';

/**
 * For values that are fine to fake in development but MUST be real in
 * production — a session secret that silently falls back to a published
 * default lets anyone forge a session cookie, and empty QBO credentials
 * fail later with a confusing 401 from Intuit rather than at boot. Failing
 * at startup is far easier to diagnose than either.
 */
const secret = (key, devFallback) => {
  const v = process.env[key];
  if (v === undefined || v === '') {
    if (isProduction) {
      throw new Error(`${key} must be set when NODE_ENV=production (refusing to use the development default)`);
    }
    return devFallback;
  }
  return v;
};

const environment = env('QBO_ENVIRONMENT', 'sandbox'); // 'sandbox' | 'production'

export const config = {
  port: Number(env('PORT', '4000')),
  isProduction,
  clientOrigin: env('CLIENT_ORIGIN', 'http://192.168.1.25.nip.io:5173'),
  sessionSecret: secret('SESSION_SECRET', 'dev-only-change-me'),

  qbo: {
    environment,
    clientId: secret('QBO_CLIENT_ID', ''),
    clientSecret: secret('QBO_CLIENT_SECRET', ''),
    redirectUri: env('QBO_REDIRECT_URI', 'https://192.168.1.25.nip.io:4000/quickbooks-return'),
    scopes: ['com.intuit.quickbooks.accounting', 'openid', 'profile', 'email'],

    // Intuit OAuth2 endpoints are the same for sandbox and production.
    authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    revokeUrl: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',

    apiBase:
      environment === 'production'
        ? 'https://quickbooks.api.intuit.com'
        : 'https://sandbox-quickbooks.api.intuit.com',

    // Bump this when Intuit ships a new minor version you want to opt into.
    minorVersion: env('QBO_MINOR_VERSION', '75'),

    // Intuit's published limits: 500 requests/min/realm, 10 concurrent.
    // We stay comfortably under both.
    maxConcurrent: 6,
    minRequestGapMs: 130,
    maxBatchItems: 30, // hard limit imposed by the QBO Batch API
  },

  cache: {
    // How long a generated summary stays fresh before a refresh re-fetches.
    ttlMs: Number(env('SUMMARY_TTL_MS', String(15 * 60 * 1000))),
  },

  scheduler: {
    enabled: env('AUTO_REFRESH_ENABLED', 'false') === 'true',
    // Default: every weekday at 06:00 server time.
    cron: env('AUTO_REFRESH_CRON', '0 6 * * 1-5'),
  },

  dataDir: env('DATA_DIR', './.data'),

  tls: {
    // Local HTTPS for the Intuit OAuth callback. Generate with mkcert:
    //   mkcert -key-file server/certs/localhost-key.pem -cert-file server/certs/localhost.pem localhost 127.0.0.1 ::1
    // Falls back to plain HTTP if the files aren't present.
    certFile: env('TLS_CERT_FILE', './certs/localhost.pem'),
    keyFile: env('TLS_KEY_FILE', './certs/localhost-key.pem'),
  },
};

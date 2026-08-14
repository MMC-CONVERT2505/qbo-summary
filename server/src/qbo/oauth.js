import crypto from 'node:crypto';
import { config } from '../config.js';
import { store } from '../lib/store.js';
import { logger } from '../lib/logger.js';

const basicAuth = () =>
  'Basic ' +
  Buffer.from(`${config.qbo.clientId}:${config.qbo.clientSecret}`).toString('base64');

export function buildAuthorizeUrl() {
  const state = crypto.randomBytes(24).toString('hex');
  const url = new URL(config.qbo.authorizeUrl);
  url.searchParams.set('client_id', config.qbo.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.qbo.scopes.join(' '));
  url.searchParams.set('redirect_uri', config.qbo.redirectUri);
  url.searchParams.set('state', state);
  return { url: url.toString(), state };
}

async function postToken(params) {
  const res = await fetch(config.qbo.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(`Token request failed (${res.status})`), {
      status: res.status,
      detail: body,
    });
  }
  return body;
}

function toRecord(realmId, token, previous = {}) {
  const now = Date.now();
  return {
    realmId,
    accessToken: token.access_token,
    // Intuit only returns a new refresh token sometimes; keep the old one otherwise.
    refreshToken: token.refresh_token ?? previous.refreshToken,
    // access_token: ~1h. refresh_token: 100 days, and rotates roughly every 24h of use.
    accessTokenExpiresAt: now + (token.expires_in ?? 3600) * 1000,
    refreshTokenExpiresAt:
      now + (token.x_refresh_token_expires_in ?? 100 * 24 * 3600) * 1000,
    connectedAt: previous.connectedAt ?? now,
    updatedAt: now,
  };
}

export async function exchangeCodeForTokens({ code, realmId }) {
  const token = await postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.qbo.redirectUri,
  });
  const record = toRecord(realmId, token);
  await store.set('tokens', realmId, record);
  logger.info(`Connected QBO realm ${realmId}`);
  return record;
}

/**
 * Refresh with a small in-process lock so a burst of parallel API calls
 * can't fire several refreshes at once and invalidate each other's tokens.
 */
const inFlight = new Map();

export async function refreshTokens(realmId) {
  if (inFlight.has(realmId)) return inFlight.get(realmId);

  const promise = (async () => {
    const existing = await store.get('tokens', realmId);
    if (!existing) throw new Error(`No stored tokens for realm ${realmId}`);

    if (Date.now() > existing.refreshTokenExpiresAt) {
      throw Object.assign(new Error('Refresh token expired — reconnect required'), {
        code: 'REAUTH_REQUIRED',
      });
    }

    const token = await postToken({
      grant_type: 'refresh_token',
      refresh_token: existing.refreshToken,
    });
    const record = toRecord(realmId, token, existing);
    await store.set('tokens', realmId, record);
    logger.info(`Refreshed access token for realm ${realmId}`);
    return record;
  })().finally(() => inFlight.delete(realmId));

  inFlight.set(realmId, promise);
  return promise;
}

/** Returns a valid access token, refreshing 2 minutes ahead of expiry. */
export async function getValidTokens(realmId) {
  const existing = await store.get('tokens', realmId);
  if (!existing) {
    throw Object.assign(new Error(`Realm ${realmId} is not connected`), {
      code: 'NOT_CONNECTED',
      status: 401,
    });
  }
  if (Date.now() > existing.accessTokenExpiresAt - 120_000) {
    return refreshTokens(realmId);
  }
  return existing;
}

export async function disconnect(realmId) {
  const existing = await store.get('tokens', realmId);
  if (existing) {
    await fetch(config.qbo.revokeUrl, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ token: existing.refreshToken }),
    }).catch((err) => logger.warn('Revoke call failed', err.message));
  }
  await store.remove('tokens', realmId);

  // Summaries are keyed `realmId:mode` (see services/summary.js cacheKey),
  // not by bare realmId — removing the bare id matched nothing, so a
  // disconnected company's cached data used to survive on disk and could
  // still be served to whoever reconnected next.
  const summaryKeys = await store.keys('summaries');
  for (const key of summaryKeys) {
    if (key === realmId || key.startsWith(`${realmId}:`)) {
      await store.remove('summaries', key);
    }
  }
}

export async function listConnections() {
  const ids = await store.keys('tokens');
  return Promise.all(
    ids.map(async (id) => {
      const t = await store.get('tokens', id);
      return {
        realmId: id,
        connectedAt: t.connectedAt,
        refreshTokenExpiresAt: t.refreshTokenExpiresAt,
      };
    })
  );
}

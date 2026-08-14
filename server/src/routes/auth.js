import { Router } from 'express';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { qbo } from '../qbo/client.js';
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  disconnect,
  listConnections,
} from '../qbo/oauth.js';

export const authRouter = Router();

/**
 * Step 1 — send the browser to Intuit.
 * The `state` value is kept in the session and verified on the way back, which
 * is what stops a third party from feeding us their own authorization code.
 */
authRouter.get('/connect', (req, res) => {
  const { url, state } = buildAuthorizeUrl();
  req.session.oauthState = state;
  res.json({ url });
});

/**
 * Step 2 — Intuit redirects the browser here with ?code, ?state and ?realmId.
 * Mounted directly on the app (see index.js) at config.qbo.redirectUri's path,
 * not under /api/auth — it's a top-level browser navigation target, not an
 * XHR route the client proxies through.
 */
export async function handleQboReturn(req, res) {
  const { code, state, realmId, error, error_description: errorDescription } = req.query;
  const back = (params) =>
    res.redirect(`${config.clientOrigin}/?${new URLSearchParams(params)}`);

  if (error) return back({ error: errorDescription ?? error });
  if (!code || !realmId) return back({ error: 'Intuit did not return an authorization code.' });
  if (!state || state !== req.session.oauthState) {
    return back({ error: 'Sign-in state did not match. Start the connection again.' });
  }

  delete req.session.oauthState;

  try {
    await exchangeCodeForTokens({ code, realmId });
    req.session.realmId = realmId;
    return back({ connected: realmId });
  } catch (err) {
    logger.error('Token exchange failed', err.detail ?? err.message);
    return back({ error: 'Could not complete the connection to QuickBooks.' });
  }
}

/**
 * Which company this browser session is currently pointed at. Includes the
 * company name via a single lightweight companyinfo call — cheap enough to
 * make on every status check, unlike a full summary build — so screens
 * before the first count (e.g. period selection) can show the real name
 * instead of a placeholder.
 *
 * Deliberately does NOT default to "whichever company connected first" when
 * this session hasn't picked one — a session with no realmId of its own
 * means this browser hasn't connected/selected a company, not "borrow
 * someone else's." `connections` still lists everything connected (for the
 * company-switcher once a session has actually chosen one).
 */
authRouter.get('/status', async (req, res) => {
  const connections = await listConnections();
  const realmId = req.session.realmId ?? null;

  let companyName = null;
  if (realmId) {
    try {
      const info = await qbo.companyInfo(realmId);
      companyName = info.CompanyName ?? null;
    } catch (err) {
      logger.warn(`Could not read company name for ${realmId}: ${err.message}`);
    }
  }

  res.json({
    connected: Boolean(realmId),
    realmId,
    companyName,
    environment: config.qbo.environment,
    connections,
  });
});

// The old POST /select ("switch the active company without reconnecting")
// has been removed. It let any session point itself at any already-connected
// company just by naming its realm id, and nothing in the UI used it any
// more once the company-switcher dropdown was taken out. Switching companies
// now goes through Disconnect -> Connect, which re-runs OAuth.

/**
 * Disconnects whatever company THIS session is connected to. The realmId is
 * taken from the session, never from the request body — reading it from the
 * body (as this used to) let an anonymous POST revoke any company's tokens
 * just by naming its realm id.
 */
authRouter.post('/disconnect', async (req, res) => {
  const realmId = req.session.realmId;
  if (!realmId) return res.status(400).json({ error: 'No company to disconnect.' });
  await disconnect(realmId);
  delete req.session.realmId;
  res.json({ disconnected: realmId });
});

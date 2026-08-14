import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import http from 'node:http';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { FileSessionStore } from './lib/sessionStore.js';
import { authRouter, handleQboReturn } from './routes/auth.js';
import { summaryRouter } from './routes/summary.js';
import { startScheduler } from './services/scheduler.js';

// Node's default for an unhandled rejection is to kill the process — one
// stray promise anywhere (a QBO call that rejects outside a try/catch, say)
// would take the server down for every user. Log and keep serving instead.
// uncaughtException is genuinely unsafe to continue from (state may be
// corrupt), so that one is logged and then rethrown to a real exit, which
// is what a process manager should restart.
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection: ${reason?.stack ?? reason}`);
});
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception — exiting: ${err?.stack ?? err}`);
  process.exit(1);
});

const app = express();

app.set('trust proxy', 1);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // Helmet's HSTS header pins by hostname, not port. In dev the same host
    // (e.g. 192.168.1.25.nip.io) serves the API over HTTPS on :4000 and the
    // Vite client over plain HTTP on :5173 — an HSTS pin from :4000 forces the
    // browser to try HTTPS against :5173 too, which can't answer TLS at all.
    hsts: process.env.NODE_ENV === 'production',
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: config.clientOrigin, credentials: true }));

app.use(
  session({
    name: 'qbo.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    // Disk-backed rather than the default in-memory store: `requireRealm`
    // resolves the company from the session, so an in-memory store would push
    // every user back through the full OAuth flow on every restart — i.e. on
    // every deploy. See lib/sessionStore.js.
    store: new FileSessionStore(),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      maxAge: 12 * 60 * 60 * 1000,
    },
  })
);

app.get('/api/health', (req, res) =>
  res.json({ ok: true, environment: config.qbo.environment, time: new Date().toISOString() })
);

// Mounted from config so this always matches QBO_REDIRECT_URI's path exactly —
// it's a direct browser navigation target Intuit redirects to, not an /api/auth route.
app.get(new URL(config.qbo.redirectUri).pathname, handleQboReturn);

app.use('/api/auth', authRouter);
app.use('/api/summary', summaryRouter);

/**
 * Serve the built client, when there is one.
 *
 * In development there isn't: the Vite dev server serves the UI on :5173 and
 * proxies /api and the OAuth callback back here, so this block is skipped and
 * nothing changes. In production the image contains client/dist and Express
 * serves it directly — so the app is a single origin with no proxy in front
 * of it, and no dev server anywhere near production.
 *
 * Mounted after the API routes and the OAuth callback so those always win;
 * the catch-all below only handles real navigation, never /api paths (an
 * unknown /api route must still 404 as JSON, not silently return index.html).
 */
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  // Hashed asset filenames can cache hard; index.html must not, or browsers
  // pin an old build that points at assets a later deploy has deleted.
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  logger.info(`Serving built client from ${clientDist}`);
} else {
  logger.info('No client build found — API only (the Vite dev server serves the UI in development)');
}

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status ?? (err.code === 'REAUTH_REQUIRED' ? 401 : 500);
  if (status >= 500) logger.error(err.stack ?? err.message);
  else logger.warn(`${status} ${err.message}`);

  res.status(status).json({
    error: err.message ?? 'Something went wrong.',
    code: err.code ?? null,
    ...(process.env.NODE_ENV !== 'production' && err.detail ? { detail: err.detail } : {}),
  });
});

const tlsOptions = (() => {
  try {
    return {
      cert: fs.readFileSync(config.tls.certFile),
      key: fs.readFileSync(config.tls.keyFile),
    };
  } catch {
    return null;
  }
})();

const server = tlsOptions ? https.createServer(tlsOptions, app) : http.createServer(app);
if (!tlsOptions) {
  if (config.isProduction) {
    // Expected in the container: Caddy (or whatever sits in front) terminates
    // TLS and forwards plain HTTP here. `trust proxy` above makes Express read
    // X-Forwarded-Proto, so secure cookies still behave correctly.
    logger.info('Serving plain HTTP — expecting TLS to terminate at the reverse proxy in front.');
  } else {
    logger.warn(`No TLS cert at ${config.tls.certFile} — serving plain HTTP. Intuit's OAuth callback needs HTTPS.`);
  }
}

server.listen(config.port, () => {
  const scheme = tlsOptions ? 'https' : 'http';
  logger.info(`QBO Summary API on ${scheme}://localhost:${config.port} (${config.qbo.environment})`);
  startScheduler();
});

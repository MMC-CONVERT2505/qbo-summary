import { Router } from 'express';
import { getSummary, generateSummary, getCachedSummary } from '../services/summary.js';
import { buildExcel } from '../services/excel.js';
import { refreshAll, schedulerStatus } from '../services/scheduler.js';

export const summaryRouter = Router();

/**
 * Every route below needs a company; resolve it once — strictly from the
 * session.
 *
 * This deliberately does NOT read a realmId from the query string or body.
 * It used to (`req.query.realmId ?? req.body?.realmId ?? req.session.realmId`),
 * which meant the 401 guard could be walked straight past: an anonymous
 * request to `/api/summary/cached?realmId=<any connected realm>` returned
 * that company's full summary — name, financials, AR/AP, counts — with no
 * session at all. Realm ids are not secrets (they show up in the UI and in
 * logs), so they can never be the thing that authorises a request.
 *
 * It also does NOT fall back to "whichever company connected first" — a
 * session with no realmId means this browser hasn't connected a company
 * yet, not "borrow someone else's".
 */
async function requireRealm(req, res, next) {
  const realmId = req.session.realmId;
  if (!realmId) {
    return res.status(401).json({
      error: 'No QuickBooks company is connected.',
      code: 'NOT_CONNECTED',
    });
  }
  req.realmId = realmId;
  next();
}

const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

const filename = (summary, ext) =>
  `${slug(summary.company.name)}-qbo-summary-${summary.generatedAt.slice(0, 10)}.${ext}`;

const VALID_MODES = new Set(['ytd', 'twoYearYtd', 'inception', 'custom']);

/** ?mode=ytd|twoYearYtd|inception|custom (&start=&end= for custom). Omitted -> default. */
function parseRange(req) {
  const mode = req.query.mode;
  if (!mode) return undefined;
  if (!VALID_MODES.has(mode)) {
    throw Object.assign(new Error(`Invalid range mode: ${mode}`), { status: 400 });
  }
  if (mode === 'custom') {
    const { start, end } = req.query;
    if (!start || !end) {
      throw Object.assign(new Error('Custom range requires both start and end query params'), {
        status: 400,
      });
    }
    return { mode, start, end };
  }
  return { mode };
}

summaryRouter.use(requireRealm);

/** Cached read; add ?force=true to rebuild. */
summaryRouter.get('/', async (req, res, next) => {
  try {
    const range = parseRange(req);
    const summary = await getSummary(req.realmId, { force: req.query.force === 'true', range });
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

/**
 * Rebuild with live progress. A full summary takes 10–30 seconds on a large
 * file, so the browser watches the stages rather than staring at a spinner.
 */
summaryRouter.get('/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);

  try {
    const range = parseRange(req);
    const summary = await generateSummary(req.realmId, {
      range,
      onProgress: (p) => send('progress', p),
      onCounts: (c) => send('counts', c),
    });
    send('summary', summary);
  } catch (err) {
    send('failed', { error: err.message, code: err.code ?? null });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

/** Whatever was last generated, without triggering a fetch. */
summaryRouter.get('/cached', async (req, res, next) => {
  try {
    const range = parseRange(req);
    const cached = await getCachedSummary(req.realmId, range);
    if (!cached) return res.status(404).json({ error: 'Nothing generated for this company yet.' });
    res.json(cached);
  } catch (err) {
    next(err);
  }
});

summaryRouter.get('/export/excel', async (req, res, next) => {
  try {
    const range = parseRange(req);
    const summary = await getSummary(req.realmId, { range });
    const buffer = await buildExcel(summary);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename(summary, 'xlsx')}"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});

summaryRouter.get('/schedule', (req, res) => res.json(schedulerStatus()));

/** Manual trigger for the same job the cron runs. */
summaryRouter.post('/schedule/run', async (req, res, next) => {
  try {
    res.json({ results: await refreshAll() });
  } catch (err) {
    next(err);
  }
});

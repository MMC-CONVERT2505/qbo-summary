import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { createLimiter } from '../lib/limiter.js';
import { getValidTokens, refreshTokens } from './oauth.js';

// One limiter per realm, not one shared across the whole process. Intuit's
// own limits (500 req/min, 10 concurrent) are per-realm too, so this
// actually matches reality — and it means a huge build for one company
// (e.g. a "Since inception" pull that fans out into dozens of report calls,
// see transactionDetail.js) can never starve a different company's simple
// requests, like an unrelated user's /api/auth/status check, by sitting
// ahead of it in the same queue. Confirmed live: before this, one company's
// pile-up of overlapping big builds pushed other realms' plain status
// checks past nginx's timeout entirely (504s) even though those requests
// individually take milliseconds.
const limiters = new Map();
function limiterFor(realmId) {
  let l = limiters.get(realmId);
  if (!l) {
    l = createLimiter({ maxConcurrent: config.qbo.maxConcurrent, minGapMs: config.qbo.minRequestGapMs });
    limiters.set(realmId, l);
  }
  return l;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class QboError extends Error {
  constructor(message, { status, detail, code } = {}) {
    super(message);
    this.name = 'QboError';
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

function describeFault(body) {
  const fault = body?.Fault ?? body?.fault;
  const err = fault?.Error?.[0];
  if (!err) return null;
  return {
    code: err.code,
    message: err.Message ?? err.message,
    detail: err.Detail ?? err.detail,
    type: fault.type,
  };
}

/**
 * One authenticated call against the QBO v3 API.
 * Handles token refresh, throttling, and retry on 429 / 5xx.
 */
async function request(realmId, { path, method = 'GET', query = {}, body, accept = 'application/json' }) {
  const attempt = async (tries = 0, forceRefresh = false) => {
    const tokens = forceRefresh ? await refreshTokens(realmId) : await getValidTokens(realmId);

    const url = new URL(`${config.qbo.apiBase}/v3/company/${realmId}/${path}`);
    url.searchParams.set('minorversion', config.qbo.minorVersion);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }

    const res = await limiterFor(realmId)(() =>
      fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          Accept: accept,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })
    );

    // Expired or revoked access token — refresh once, then retry.
    if (res.status === 401 && !forceRefresh) return attempt(tries, true);

    if ((res.status === 429 || res.status >= 500) && tries < 3) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** tries * 750 + Math.random() * 250;
      logger.warn(`QBO ${res.status} on ${path} — retrying in ${Math.round(backoff)}ms`);
      await sleep(backoff);
      return attempt(tries + 1, forceRefresh);
    }

    if (accept !== 'application/json') {
      if (!res.ok) throw new QboError(`QBO ${res.status} on ${path}`, { status: res.status });
      return Buffer.from(await res.arrayBuffer());
    }

    const json = await res.json().catch(() => ({}));
    const fault = describeFault(json);

    if (!res.ok || fault) {
      throw new QboError(fault?.message ?? `QBO request failed (${res.status})`, {
        status: res.status,
        code: fault?.code,
        detail: fault,
      });
    }
    return json;
  };

  return attempt();
}

export const qbo = {
  request,

  /** Run a single QBO SQL-ish query. */
  async query(realmId, statement) {
    const res = await request(realmId, { path: 'query', query: { query: statement } });
    return res.QueryResponse ?? {};
  },

  /**
   * Run many queries in as few round trips as possible.
   * The Batch API accepts 30 operations per call, so ~20 count queries
   * collapse into a single HTTP request.
   *
   * `items` is [{ id, query }]. Returns { [id]: { ok, totalCount?, rows?, error? } }.
   */
  async batchQuery(realmId, items) {
    const out = {};
    for (let i = 0; i < items.length; i += config.qbo.maxBatchItems) {
      const chunk = items.slice(i, i + config.qbo.maxBatchItems);
      const res = await request(realmId, {
        path: 'batch',
        method: 'POST',
        body: { BatchItemRequest: chunk.map((it) => ({ bId: it.id, Query: it.query })) },
      });

      for (const item of res.BatchItemResponse ?? []) {
        const fault = describeFault(item);
        if (fault) {
          // A single unsupported entity (e.g. Class when class tracking is off)
          // must not sink the whole summary.
          out[item.bId] = { ok: false, error: fault.message ?? 'Query failed', code: fault.code };
        } else {
          const qr = item.QueryResponse ?? {};
          out[item.bId] = {
            ok: true,
            totalCount: qr.totalCount ?? null,
            maxResults: qr.maxResults ?? null,
            raw: qr,
          };
        }
      }
    }
    return out;
  },

  /** Fetch a QBO report (ProfitAndLoss, BalanceSheet, AgedReceivables, ...). */
  async report(realmId, name, params = {}) {
    return request(realmId, { path: `reports/${name}`, query: params });
  },

  /** Company metadata — name, fiscal year start, country, currency. */
  async companyInfo(realmId) {
    const res = await request(realmId, { path: `companyinfo/${realmId}` });
    return res.CompanyInfo ?? {};
  },

  /** Company-wide settings, incl. TaxPrefs.UsingSalesTax (VAT/GST/sales tax, depending on locale). */
  async preferences(realmId) {
    const res = await request(realmId, { path: 'preferences' });
    return res.Preferences ?? {};
  },

  /** Page through every record of an entity, honouring QBO's 1000-row cap. */
  async queryAll(realmId, entity, { where = '', select = '*', pageSize = 1000, onPage } = {}) {
    const rows = [];
    let start = 1;
    for (;;) {
      const statement =
        `select ${select} from ${entity}${where ? ` where ${where}` : ''} ` +
        `startposition ${start} maxresults ${pageSize}`;
      const qr = await this.query(realmId, statement);
      const page = qr[entity] ?? [];
      onPage?.(page);
      rows.push(...page);
      if (page.length < pageSize) break;
      start += pageSize;
    }
    return rows;
  },
};

export { QboError };

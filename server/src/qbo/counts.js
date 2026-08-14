import { qbo } from './client.js';
import { LIST_ENTITIES, TRANSACTION_ENTITIES, CHART_BREAKOUTS, countQuery } from './catalog.js';
import { fetchTransactionTypeCounts, fetchTransactionLineCounts } from './transactionDetail.js';
import { logger } from '../lib/logger.js';

/** Faults that mean "this feature isn't turned on", not "something broke". */
const NOT_ENABLED = /not (enabled|supported)|invalid (entity|query)|unsupported/i;

function interpret(spec, result) {
  if (result?.ok) return { status: 'ok', count: Number(result.totalCount ?? 0) };
  const message = result?.error ?? 'No response';
  if (spec.optional || NOT_ENABLED.test(message)) {
    return { status: 'unavailable', count: null, note: 'Not enabled on this company file' };
  }
  return { status: 'error', count: null, note: message };
}

/**
 * Phase 1 payload. Lists (master data — customers, vendors, chart of
 * accounts, etc.) are always the file's full total, regardless of the
 * selected date range — asking "how many customers were created in this
 * period" isn't a useful question for a file review; you want the whole
 * roster. Transactions are the opposite: they're scoped to whatever date
 * range the dashboard has selected, since "how much happened this period"
 * is exactly the point. List entities are counted twice (active vs. all)
 * so the dashboard can show how much of the file is dormant.
 */
function activeInactiveRow(spec, results) {
  const active = interpret(spec, results[`list:${spec.key}:active`]);
  const all = interpret(spec, results[`list:${spec.key}:all`]);
  const total = all.status === 'ok' ? all.count : active.count;
  return {
    key: spec.key,
    label: spec.label,
    group: spec.group,
    entity: spec.entity,
    status: all.status === 'ok' ? active.status : all.status,
    note: active.note ?? all.note,
    active: active.count,
    total,
    inactive: total !== null && active.count !== null ? total - active.count : null,
  };
}

/**
 * Rolls the flat per-entity transaction rows up into the parent buckets
 * defined by `spec.bucket` in catalog.js. Only used by the count(*)-based
 * fallback path below — the primary path gets its buckets straight from
 * `fetchTransactionTypeCounts()`, which is already bucketed.
 */
export function bucketTransactions(transactions) {
  const order = [];
  const byBucket = new Map();

  for (const row of transactions) {
    if (!byBucket.has(row.bucket)) {
      byBucket.set(row.bucket, { label: row.bucket, total: 0, hasError: false, notes: [], members: [] });
      order.push(row.bucket);
    }
    const b = byBucket.get(row.bucket);
    b.members.push(row.label);
    if (row.status === 'ok') b.total += row.total ?? 0;
    if (row.status === 'error') {
      b.hasError = true;
      b.notes.push(`${row.label}: ${row.note}`);
    }
  }

  return order.map((label) => {
    const b = byBucket.get(label);
    return {
      key: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      label,
      total: b.total,
      status: b.hasError ? 'error' : 'ok',
      note: b.hasError ? b.notes.join('; ') : null,
      members: b.members,
    };
  });
}

/**
 * Fallback transaction counting via count(*), used only if the Journal
 * report call fails outright. Known weaker than the report-based path —
 * count(*) filtered by Purchase.PaymentType is unreliable (confirmed live:
 * silently undercounts by 90%+ for some values), so Purchase is paged and
 * tallied client-side here too, same as attachments already are.
 */
const PURCHASE_PAYMENT_TYPES = { expenses: 'Cash', checks: 'Check', cardCharges: 'CreditCard' };

async function fetchPurchaseSplit(realmId, range) {
  const clauses = [];
  if (range?.start) clauses.push(`TxnDate >= '${range.start}'`);
  if (range?.end) clauses.push(`TxnDate <= '${range.end}'`);
  const where = clauses.join(' and ');

  let pages = 0;
  const rows = await qbo.queryAll(realmId, 'Purchase', {
    select: 'Id, PaymentType',
    where,
    onPage: () => { pages += 1; },
  });
  const tally = { Cash: 0, Check: 0, CreditCard: 0 };
  for (const r of rows) {
    if (r.PaymentType in tally) tally[r.PaymentType] += 1;
  }
  return { tally, pages: Math.max(pages, 1) };
}

async function fetchTransactionsViaEntityCounts(realmId, range) {
  const items = [];
  for (const spec of TRANSACTION_ENTITIES) {
    if (spec.key in PURCHASE_PAYMENT_TYPES) continue; // handled by fetchPurchaseSplit below
    items.push({ id: `txn:${spec.key}`, query: countQuery(spec, { dateRange: range }) });
  }

  const [results, purchaseSplit] = await Promise.all([
    qbo.batchQuery(realmId, items),
    fetchPurchaseSplit(realmId, range),
  ]);

  const transactions = TRANSACTION_ENTITIES.map((spec) => {
    const paymentType = PURCHASE_PAYMENT_TYPES[spec.key];
    const r = paymentType
      ? { status: 'ok', count: purchaseSplit.tally[paymentType] ?? 0, note: null }
      : interpret(spec, results[`txn:${spec.key}`]);
    return {
      key: spec.key,
      label: spec.label,
      bucket: spec.bucket,
      status: r.status,
      note: r.note,
      total: r.count,
    };
  });

  return {
    transactions,
    transactionBuckets: bucketTransactions(transactions),
    queriesIssued: items.length + purchaseSplit.pages,
  };
}

export async function fetchCounts(realmId, { range } = {}) {
  const items = [];

  for (const spec of [...LIST_ENTITIES, ...CHART_BREAKOUTS]) {
    items.push({ id: `list:${spec.key}:active`, query: countQuery(spec) });
    items.push({
      id: `list:${spec.key}:all`,
      query: countQuery(spec, { includeInactive: true }),
    });
  }

  const [results, txn, lines] = await Promise.all([
    qbo.batchQuery(realmId, items),
    // Exact-entry count: QBO's own Journal report, grouped by transaction
    // id — gives the exact number of distinct transactions/entries
    // directly (see transactionDetail.js). count(*) queries can't be
    // trusted for some of these splits (see fetchTransactionsViaEntityCounts).
    fetchTransactionTypeCounts(realmId, range).catch(async (err) => {
      logger.warn(`Journal report failed, falling back to count(*): ${err.message}`);
      const fallback = await fetchTransactionsViaEntityCounts(realmId, range);
      return {
        totalEntries: fallback.transactions.reduce((s, r) => s + (r.total ?? 0), 0),
        byType: fallback.transactions,
        buckets: fallback.transactionBuckets,
        degraded: true,
        queriesIssued: fallback.queriesIssued,
      };
    }),
    // "Total Lines" count: run in parallel with, not instead of, the
    // exact-entry count above — a client's manual review process wants
    // both numbers, not one or the other. Soft-fails: this is a secondary
    // figure (Excel-only), so a failure here shouldn't sink the summary.
    fetchTransactionLineCounts(realmId, range).catch((err) => {
      logger.warn(`Transaction Detail by Account report failed: ${err.message}`);
      return null;
    }),
  ]);

  const lists = LIST_ENTITIES.map((spec) => activeInactiveRow(spec, results));
  // Subset of 'accounts' above (AR/AP-type accounts specifically) — kept out
  // of `lists`/totals so they're never double-counted.
  const chartBreakouts = CHART_BREAKOUTS.map((spec) => activeInactiveRow(spec, results));

  const transactions = txn.byType.map((r) => ({
    key: r.key,
    label: r.label,
    bucket: r.bucket ?? r.label,
    status: 'ok',
    note: null,
    total: r.total,
  }));

  const sum = (rows, field) =>
    rows.reduce((acc, r) => acc + (typeof r[field] === 'number' ? r[field] : 0), 0);

  // "Total Lines" — same shape as transactions/transactionBuckets above,
  // computed from the raw line count instead of unique entries. Null when
  // that report call failed; consumers (currently just the Excel export)
  // need to handle that.
  const transactionLines = lines?.byType.map((r) => ({
    key: r.key,
    label: r.label,
    bucket: r.bucket ?? r.label,
    status: 'ok',
    note: null,
    total: r.total,
  })) ?? null;

  return {
    lists,
    chartBreakouts,
    transactions,
    transactionBuckets: txn.buckets,
    transactionLines,
    transactionLineBuckets: lines?.buckets ?? null,
    totals: {
      listRecords: sum(lists, 'total'),
      inactiveRecords: sum(lists, 'inactive'),
      transactionRecords: txn.totalEntries,
      transactionLines: lines?.totalLines ?? null,
    },
    queriesIssued: items.length + 2,
  };
}

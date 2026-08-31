import { qbo } from './client.js';

/**
 * Maps QBO's own "Transaction Type" report labels to the bucket scheme —
 * confirmed line-for-line against a real client's manual QBO export
 * (Transaction Detail by Account, filtered by Transaction Type in Excel).
 * Every bucket total matched exactly once the date range was right.
 *
 * This report is also the only reliable way to split Bill Payments and
 * Purchases by how they were paid — count(*) filtered by PaymentType/
 * PayType is not trustworthy (confirmed live: silently undercounts by
 * 90%+ for some values, see counts.js).
 */
const BUCKET_OF = {
  // US labels
  Expense: 'Bank',
  Check: 'Bank',
  Payment: 'Bank',
  'Bill Payment (Check)': 'Bank',
  Deposit: 'Bank',
  Transfer: 'Bank',
  'Credit Card Credit': 'Credit Card',
  'Credit Card Payment': 'Credit Card',
  'Credit Card Expense': 'Credit Card',
  'Credit Card Charge': 'Credit Card',
  'Bill Payment (Credit Card)': 'Credit Card',
  Bill: 'Bill',
  'Vendor Credit': 'Bill Credit',
  Invoice: 'Invoice',
  'Credit Memo': 'Credit memo',
  'Journal Entry': 'Manual Journal',
  'Sales Receipt': 'Sales receipts',
  Estimate: 'Estimates',
  'Purchase Order': 'Purchase orders',
  'Refund Receipt': 'Refund receipts',
  'Time Charge': 'Time activities',
  'Time Activity': 'Time activities',
  // Non-US locales (UK/AU/etc.) use different display names for the same
  // transactions — confirmed live: "Cheque" not "Check", "Credit Note" not
  // "Credit Memo", "Supplier Credit" not "Vendor Credit" (UK edition), and
  // "GST Payment" for a tax remittance (AU edition) — same underlying QBO
  // entity as a US "Tax Payment", just a regional label.
  Cheque: 'Bank',
  'Cheque Expense': 'Bank',
  'Bill Payment (Cheque)': 'Bank',
  'Tax Payment': 'Bank',
  'GST Payment': 'Bank',
  'Credit Note': 'Credit memo',
  'Supplier Credit': 'Bill Credit',
  Refund: 'Refund receipts',
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * QBO silently caps both these reports on a large date range (confirmed
 * live: a 20k+ transaction "Since inception" pull stopped partway through
 * with no error — just a fake Data row reading "Unable to display more
 * data. Please reduce the date range.", API-visible as a normal 200
 * response). Left undetected, that produced a confidently-wrong,
 * undercounted "Transactions" total (12,487 shown vs. ~20,570 real) with
 * nothing telling the caller anything was missing. Both report functions
 * below check for this and throw, so the existing count(*) fallback in
 * counts.js — unaffected by report truncation since it doesn't use reports
 * at all — takes over instead of returning a silently incomplete count.
 */
const TRUNCATION_MESSAGE = 'Unable to display more data';

function isTruncationRow(row) {
  return row?.ColData?.some((c) => c?.value?.includes(TRUNCATION_MESSAGE)) ?? false;
}

/** Shared by both counting paths below — rolls a { label: count } tally into bucket rows. */
function toBucketedResult(byType) {
  const byTypeRows = [...byType.entries()]
    .map(([label, total]) => ({ key: slug(label), label, bucket: BUCKET_OF[label] ?? label, total }))
    .sort((a, b) => b.total - a.total);

  const byBucket = new Map();
  for (const row of byTypeRows) {
    const b = byBucket.get(row.bucket) ?? { label: row.bucket, total: 0, members: [] };
    b.total += row.total;
    b.members.push(row.label);
    byBucket.set(row.bucket, b);
  }
  const buckets = [...byBucket.values()]
    .map((b) => ({ key: slug(b.label), label: b.label, total: b.total, status: 'ok', note: null, members: b.members }))
    .sort((a, b) => b.total - a.total);

  return { byType: byTypeRows, buckets };
}

/**
 * QBO's Journal report — unlike Transaction Detail by Account, every line
 * of a transaction (even blank continuation rows) carries the same
 * transaction id in the Transaction Type column, so grouping by that id
 * gives the exact number of distinct transactions/entries directly, no
 * separate de-duplication pass needed. Confirmed live: a 726-line report
 * collapsed to 161 unique transactions this way, matching the report's own
 * visual grouping (one block per transaction, date shown once, its
 * debit/credit lines nested under it).
 *
 * This is the "exact entries" count — see fetchTransactionLineCounts below
 * for the "Total Lines" count, which the app runs in parallel with this
 * one rather than picking a single method.
 */
async function fetchTransactionTypeCountsOnce(realmId, range) {
  const params = {};
  if (range?.start) params.start_date = range.start;
  if (range?.end) params.end_date = range.end;

  const report = await qbo.report(realmId, 'JournalReport', params);
  const allRows = report?.Rows?.Row ?? [];
  if (allRows.some(isTruncationRow)) throw new TruncatedError();
  const rows = allRows.filter((r) => r.type === 'Data');

  // The type is only printed on a transaction's first row; continuation
  // rows repeat the same id with a blank value — keep whichever row for
  // this id actually carried a type.
  const byTxn = new Map();
  for (const row of rows) {
    const id = row.ColData?.[1]?.id;
    const type = row.ColData?.[1]?.value;
    if (!id) continue;
    if (!byTxn.has(id) || (!byTxn.get(id) && type)) byTxn.set(id, type || null);
  }

  const byType = new Map();
  for (const type of byTxn.values()) {
    const label = type || '(unlabeled)';
    byType.set(label, (byType.get(label) ?? 0) + 1);
  }

  // Splitting by date is safe for de-duplication here: a transaction has
  // exactly one TxnDate, so it lands in exactly one chunk — no transaction
  // can be double-counted across two halves.
  return { total: byTxn.size, byType };
}

export async function fetchTransactionTypeCounts(realmId, range) {
  const { total, byType } = await fetchWithSplitting(fetchTransactionTypeCountsOnce, realmId, range);
  return { totalEntries: total, ...toBucketedResult(byType) };
}

/** Thrown by the single-call fetchers below when QBO capped the report. */
class TruncatedError extends Error {}

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const midpoint = (start, end) => {
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  return new Date(s + Math.floor((e - s) / 2)).toISOString().slice(0, 10);
};

/**
 * Runs a report fetcher, and when QBO truncates it, splits the date range
 * in half and runs each half separately — recursively, until every piece
 * comes back complete — then adds the pieces up. Confirmed live to land on
 * the exact real total on a file large enough that a single call truncates
 * outright (73,408 lines where one call returned a silently-capped 36,349).
 *
 * Splits on calendar-day midpoints rather than a fixed chunk size, so it
 * self-adjusts to how dense a file's real history actually is — a file with
 * 30 empty years ahead of its real data (the "Since inception" 1990 floor,
 * see periods.js) costs only the handful of cheap empty-range calls it
 * takes to bisect past them.
 *
 * `fetchOnce` must return { total, byType: Map<label, count> } and throw
 * TruncatedError when capped. Both report fetchers here are safe to split
 * this way — each row/transaction belongs to exactly one date, so no chunk
 * can double-count what another already counted.
 */
async function fetchWithSplitting(fetchOnce, realmId, range, depth = 0) {
  try {
    return await fetchOnce(realmId, range);
  } catch (err) {
    if (!(err instanceof TruncatedError)) throw err;
    if (range.start >= range.end) {
      // A single day alone is too dense for QBO to return in one call —
      // real, but extraordinarily unlikely; nothing smaller left to try.
      throw new Error(`QBO report truncated even for a single day (${range.start}) — cannot split further`);
    }
    if (depth >= 20) {
      throw new Error(`QBO report still truncating after ${depth} splits — giving up`);
    }

    const mid = midpoint(range.start, range.end);
    const rightStart = addDays(mid, 1);
    const [left, right] = await Promise.all([
      fetchWithSplitting(fetchOnce, realmId, { start: range.start, end: mid }, depth + 1),
      mid >= range.end
        ? Promise.resolve({ total: 0, byType: new Map() })
        : fetchWithSplitting(fetchOnce, realmId, { start: rightStart, end: range.end }, depth + 1),
    ]);

    const byType = new Map(left.byType);
    for (const [label, n] of right.byType) byType.set(label, (byType.get(label) ?? 0) + n);
    return { total: left.total + right.total, byType };
  }
}

async function fetchTransactionLineCountsOnce(realmId, range) {
  const params = {};
  if (range?.start) params.start_date = range.start;
  if (range?.end) params.end_date = range.end;

  const report = await qbo.report(realmId, 'TransactionDetailByAccount', params);

  const byType = new Map();
  let totalLines = 0;
  let truncated = false;

  const walk = (rows) => {
    for (const row of rows?.Row ?? []) {
      if (isTruncationRow(row)) {
        truncated = true;
        continue;
      }
      if (row.type === 'Data' && row.ColData) {
        totalLines += 1;
        const label = row.ColData[1]?.value || '(unlabeled)';
        byType.set(label, (byType.get(label) ?? 0) + 1);
      }
      if (row.Rows) walk(row.Rows);
    }
  };
  walk(report?.Rows);

  if (truncated) throw new TruncatedError();
  return { total: totalLines, byType };
}

/**
 * QBO's Transaction Detail by Account report, tallied by raw line count —
 * one transaction that posts to 2 accounts (or has multiple split lines)
 * counts twice here. This is the "Total Lines" figure a reviewer gets by
 * exporting that report and filtering by Transaction Type in Excel —
 * confirmed to match a real client's manual process exactly, category for
 * category, once the date range was right. Kept alongside the exact-entry
 * count above (fetchTransactionTypeCounts) rather than replaced by it,
 * since both numbers are meaningful for different purposes.
 */
export async function fetchTransactionLineCounts(realmId, range) {
  const { total, byType } = await fetchWithSplitting(fetchTransactionLineCountsOnce, realmId, range);
  return { totalLines: total, ...toBucketedResult(byType) };
}

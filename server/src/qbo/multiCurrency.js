import { qbo } from './client.js';
import { logger } from '../lib/logger.js';

/**
 * Transaction entities that carry a CurrencyRef field — confirmed live
 * against a real multi-currency file (Mechpro Solutions AU). TimeActivity is
 * deliberately excluded: it has no CurrencyRef field at all, confirmed live,
 * not just "always home currency" — querying it here would error.
 */
const CURRENCY_ENTITIES = [
  { key: 'invoices', label: 'Invoices', entity: 'Invoice' },
  { key: 'salesReceipts', label: 'Sales receipts', entity: 'SalesReceipt' },
  { key: 'payments', label: 'Payments received', entity: 'Payment' },
  { key: 'creditMemos', label: 'Credit memos', entity: 'CreditMemo' },
  { key: 'refundReceipts', label: 'Refund receipts', entity: 'RefundReceipt' },
  { key: 'estimates', label: 'Estimates', entity: 'Estimate' },
  { key: 'deposits', label: 'Deposits', entity: 'Deposit' },
  { key: 'bills', label: 'Bills', entity: 'Bill' },
  { key: 'billPayments', label: 'Bill payments', entity: 'BillPayment' },
  { key: 'vendorCredits', label: 'Vendor credits', entity: 'VendorCredit' },
  { key: 'purchaseOrders', label: 'Purchase orders', entity: 'PurchaseOrder' },
  { key: 'purchases', label: 'Expenses, checks & card charges', entity: 'Purchase' },
  { key: 'journalEntries', label: 'Journal entries', entity: 'JournalEntry' },
  { key: 'transfers', label: 'Transfers', entity: 'Transfer' },
];

async function tallyOne(realmId, spec, range, homeCurrency) {
  const clauses = [];
  if (range?.start) clauses.push(`TxnDate >= '${range.start}'`);
  if (range?.end) clauses.push(`TxnDate <= '${range.end}'`);
  const where = clauses.join(' and ');

  // select * (not a narrow field list) — confirmed live that JournalEntry
  // rejects `select Id, CurrencyRef` with "Invalid query" even though the
  // field is genuinely present on the record. select * works on every
  // entity in this list.
  const rows = await qbo.queryAll(realmId, spec.entity, { select: '*', where, pageSize: 1000 });

  const byCurrency = {};
  let foreign = 0;
  for (const row of rows) {
    const code = row.CurrencyRef?.value ?? homeCurrency;
    byCurrency[code] = (byCurrency[code] ?? 0) + 1;
    if (code !== homeCurrency) foreign += 1;
  }

  return { key: spec.key, label: spec.label, entity: spec.entity, total: rows.length, foreign, byCurrency };
}

/**
 * Counts foreign-currency transactions (CurrencyRef different from the
 * file's home currency), per transaction type, scoped to `range` — the same
 * period as the main Transactions counts.
 *
 * Returns null for a file that doesn't use multi-currency at all. Confirmed
 * live: on a non-multi-currency file, CurrencyRef isn't present-but-equal-
 * to-home, it's genuinely absent from every record — so there's nothing to
 * count, and paging every transaction type in full (this is real extra API
 * volume — up to a few thousand rows on a large ledger) would be pure waste
 * on the vast majority of files, which don't use this feature.
 *
 * There is no cheaper alternative: QBO rejects `where CurrencyRef = '...'`
 * outright as an invalid query (confirmed live), and the Journal report —
 * already fetched for the exact transaction count — doesn't expose currency
 * per row even on a file with genuine foreign-currency transactions in it
 * (also confirmed live). Full paging is the only reliable path.
 */
export async function fetchMultiCurrencyCounts(realmId, range) {
  let prefs;
  try {
    prefs = await qbo.preferences(realmId);
  } catch (err) {
    logger.warn(`Could not read currency preferences for ${realmId}: ${err.message}`);
    return null;
  }

  if (!prefs?.CurrencyPrefs?.MultiCurrencyEnabled) return null;

  const homeCurrency = prefs.CurrencyPrefs.HomeCurrency?.value ?? null;

  const byType = await Promise.all(
    CURRENCY_ENTITIES.map((spec) => tallyOne(realmId, spec, range, homeCurrency))
  );

  return {
    homeCurrency,
    byType,
    totalForeign: byType.reduce((s, r) => s + r.foreign, 0),
    totalTxns: byType.reduce((s, r) => s + r.total, 0),
  };
}

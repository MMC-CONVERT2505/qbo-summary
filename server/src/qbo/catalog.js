/**
 * Everything QBO Summary knows how to count.
 *
 * `entity`     — the QBO entity name used in the query
 * `where`      — optional filter (used to split Purchase into Expense/Check/Card)
 * `optional`   — true when the query legitimately fails on some company files
 *                (class/department tracking off, multicurrency off, etc.).
 *                Those come back as "not enabled" rather than as an error.
 * `hasActive`  — true for list entities, which carry an Active flag transactions don't.
 *
 * Lists (master data — customers, vendors, chart of accounts, etc.) are
 * always the file's full total, unscoped by date — a file review wants the
 * whole roster, not "created in this period." Only transactions (below) are
 * scoped to the selected date range, by TxnDate.
 *
 * QBO counts only active records unless you ask otherwise, so every list
 * entity is counted twice: active, and active+inactive. The difference is
 * the inactive count, which is usually the interesting number during a
 * file review.
 */

export const LIST_ENTITIES = [
  { key: 'accounts', label: 'Chart of accounts', entity: 'Account', group: 'Structure', hasActive: true },
  { key: 'customers', label: 'Customers', entity: 'Customer', group: 'People', hasActive: true },
  { key: 'vendors', label: 'Vendors', entity: 'Vendor', group: 'People', hasActive: true },
  { key: 'employees', label: 'Employees', entity: 'Employee', group: 'People', hasActive: true },
  { key: 'items', label: 'Products & services', entity: 'Item', group: 'Catalog', hasActive: true },
  { key: 'classes', label: 'Classes', entity: 'Class', group: 'Structure', optional: true, hasActive: true },
  { key: 'departments', label: 'Departments / locations', entity: 'Department', group: 'Structure', optional: true, hasActive: true },
  { key: 'terms', label: 'Payment terms', entity: 'Term', group: 'Structure', hasActive: true },
  { key: 'paymentMethods', label: 'Payment methods', entity: 'PaymentMethod', group: 'Structure', hasActive: true },
  { key: 'taxCodes', label: 'Tax codes', entity: 'TaxCode', group: 'Structure', optional: true, hasActive: true },
  { key: 'currencies', label: 'Currencies in use', entity: 'CompanyCurrency', group: 'Structure', optional: true, hasActive: true },
];

/**
 * QBO allows more than one Accounts Receivable / Accounts Payable account in
 * the chart of accounts (e.g. a separate AR account per foreign currency) —
 * this counts them specifically. Kept separate from LIST_ENTITIES because
 * they're a subset of the 'accounts' row above; summing them in too would
 * double-count against totals.listRecords.
 */
export const CHART_BREAKOUTS = [
  {
    key: 'arAccounts',
    label: 'Accounts receivable accounts',
    entity: 'Account',
    where: "AccountType = 'Accounts Receivable'",
    group: 'Structure',
    hasActive: true,
  },
  {
    key: 'apAccounts',
    label: 'Accounts payable accounts',
    entity: 'Account',
    where: "AccountType = 'Accounts Payable'",
    group: 'Structure',
    hasActive: true,
  },
];

/**
 * `bucket` — the parent row this entity rolls up under on the results
 * screen (per the firm's own file-review sheet, which groups by how a
 * transaction was settled rather than by QBO entity). Entities with no
 * natural parent keep their own label as a bucket of one.
 *
 * Bill payments and credit card charges are NOT split bank-vs-card here:
 * QBO's `PayType`/`PaymentType` fields aren't filterable in a count query
 * (confirmed live — `where PayType = 'Check'` on BillPayment errors as an
 * invalid query even though the field exists on the record), so doing that
 * split would mean paging every row instead of one count(*) call. Bill
 * payments are bucketed under Bank as the common case.
 */
export const TRANSACTION_ENTITIES = [
  { key: 'invoices', label: 'Invoices', entity: 'Invoice', group: 'Money in', bucket: 'Invoice', dateField: 'TxnDate' },
  { key: 'salesReceipts', label: 'Sales receipts', entity: 'SalesReceipt', group: 'Money in', bucket: 'Sales receipts', dateField: 'TxnDate' },
  { key: 'payments', label: 'Payments received', entity: 'Payment', group: 'Money in', bucket: 'Bank', dateField: 'TxnDate' },
  { key: 'creditMemos', label: 'Credit memos', entity: 'CreditMemo', group: 'Money in', bucket: 'Credit memo', dateField: 'TxnDate' },
  { key: 'refundReceipts', label: 'Refund receipts', entity: 'RefundReceipt', group: 'Money in', bucket: 'Refund receipts', dateField: 'TxnDate' },
  { key: 'estimates', label: 'Estimates', entity: 'Estimate', group: 'Money in', bucket: 'Estimates', dateField: 'TxnDate' },
  { key: 'deposits', label: 'Deposits', entity: 'Deposit', group: 'Money in', bucket: 'Bank', dateField: 'TxnDate' },

  { key: 'bills', label: 'Bills', entity: 'Bill', group: 'Money out', bucket: 'Bill', dateField: 'TxnDate' },
  { key: 'billPayments', label: 'Bill payments', entity: 'BillPayment', group: 'Money out', bucket: 'Bank', dateField: 'TxnDate' },
  { key: 'vendorCredits', label: 'Vendor credits', entity: 'VendorCredit', group: 'Money out', bucket: 'Bill Credit', dateField: 'TxnDate' },
  { key: 'purchaseOrders', label: 'Purchase orders', entity: 'PurchaseOrder', group: 'Money out', bucket: 'Purchase orders', dateField: 'TxnDate' },

  // QBO stores expenses, checks and card charges in one entity, split by PaymentType.
  {
    key: 'expenses',
    label: 'Expenses (cash)',
    entity: 'Purchase',
    where: "PaymentType = 'Cash'",
    group: 'Money out',
    bucket: 'Bank',
    dateField: 'TxnDate',
  },
  {
    key: 'checks',
    label: 'Checks',
    entity: 'Purchase',
    where: "PaymentType = 'Check'",
    group: 'Money out',
    bucket: 'Bank',
    dateField: 'TxnDate',
  },
  {
    key: 'cardCharges',
    label: 'Credit card charges',
    entity: 'Purchase',
    where: "PaymentType = 'CreditCard'",
    group: 'Money out',
    bucket: 'Credit Card',
    dateField: 'TxnDate',
  },

  { key: 'journalEntries', label: 'Journal entries', entity: 'JournalEntry', group: 'Ledger', bucket: 'Manual Journal', dateField: 'TxnDate' },
  { key: 'transfers', label: 'Transfers', entity: 'Transfer', group: 'Ledger', bucket: 'Bank', dateField: 'TxnDate' },
  { key: 'timeActivities', label: 'Time activities', entity: 'TimeActivity', group: 'Ledger', bucket: 'Time activities', dateField: 'TxnDate', optional: true },
];

/**
 * Point-in-time file-profile checks — not scoped to a date range, no
 * active/inactive split. Each backs one Yes/No or count field on the file
 * profile checklist (things LIST_ENTITIES/TRANSACTION_ENTITIES don't cover
 * on their own: whether inventory is tracked, whether Projects are in use,
 * whether any Fixed Asset accounts exist).
 */
export const PROFILE_ENTITIES = [
  { key: 'inventoryItems', label: 'Inventory items', entity: 'Item', where: "Type = 'Inventory'", optional: true },
  { key: 'fixedAssetAccounts', label: 'Fixed asset accounts', entity: 'Account', where: "AccountType = 'Fixed Asset'", optional: true },
  // QBO Online's "Projects" feature is implemented as sub-customers flagged Job = true.
  { key: 'projects', label: 'Projects', entity: 'Customer', where: 'Job = true', optional: true },
];

/** Entity types we report attachment counts against. */
export const ATTACHABLE_TYPES = [
  'Invoice', 'Bill', 'Purchase', 'SalesReceipt', 'CreditMemo', 'Estimate',
  'PurchaseOrder', 'JournalEntry', 'Payment', 'BillPayment', 'Deposit',
  'VendorCredit', 'RefundReceipt', 'Transfer',
  'Customer', 'Vendor', 'Employee', 'Item', 'Account',
];

/** Build a `select count(*)` statement for one catalog spec. */
export function countQuery(spec, { includeInactive = false, dateRange } = {}) {
  const clauses = [];
  if (spec.where) clauses.push(spec.where);
  if (includeInactive && spec.hasActive) clauses.push('Active in (true, false)');
  if (dateRange && spec.dateField) {
    if (dateRange.start) clauses.push(`${spec.dateField} >= '${dateRange.start}'`);
    if (dateRange.end) clauses.push(`${spec.dateField} <= '${dateRange.end}'`);
  }
  const where = clauses.length ? ` where ${clauses.join(' and ')}` : '';
  return `select count(*) from ${spec.entity}${where}`;
}

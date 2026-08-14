/**
 * Offline smoke test. Runs the report parser, period maths and both exporters
 * against fixture data — no Intuit credentials required.
 *
 *   node test/run.js
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { flattenReport } from '../src/qbo/reports.js';
import { buildPeriods, resolvePeriods } from '../src/qbo/periods.js';
import { countQuery, LIST_ENTITIES, TRANSACTION_ENTITIES, CHART_BREAKOUTS } from '../src/qbo/catalog.js';
import { bucketTransactions } from '../src/qbo/counts.js';
import { buildExcel } from '../src/services/excel.js';
import * as fx from './fixtures.js';

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
};

const pickGroup = (lines, group) =>
  lines.find((l) => l.group === group && l.kind === 'summary')?.values[0] ?? null;

console.log('\nReport parser');
const plLines = flattenReport(fx.profitAndLoss);
check('reads total income', () => assert.equal(pickGroup(plLines, 'Income'), 2753.55));
check('reads total expenses', () => assert.equal(pickGroup(plLines, 'Expenses'), 1088.61));
check('reads net income', () => assert.equal(pickGroup(plLines, 'NetIncome'), 1259.94));
check('keeps detail rows with account ids', () => {
  const rows = plLines.filter((l) => l.kind === 'row' && l.accountId);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].label, 'Design income');
});

const bsLines = flattenReport(fx.balanceSheet);
check('reads nested total assets', () => assert.equal(pickGroup(bsLines, 'TotalAssets'), 8465.03));
check('reads deeply nested A/P', () => assert.equal(pickGroup(bsLines, 'TotalAP'), 1602.67));
check('balance sheet ties', () =>
  assert.equal(pickGroup(bsLines, 'TotalAssets'), pickGroup(bsLines, 'TotalLiabilitiesAndEquity')));

const arLines = flattenReport(fx.agedReceivables);
check('reads aging total row', () => {
  const total = arLines.find((l) => l.kind === 'summary');
  assert.equal(total.values.at(-1), 5281.52);
  assert.equal(total.values.length, 6);
});

console.log('\nParentheses and negatives');
check('parses (1,234.50) as negative', () => {
  const neg = flattenReport({
    Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Loss' }, { value: '(1,234.50)' }] }] },
  });
  assert.equal(neg[0].values[0], -1234.5);
});
check('parses $ and commas', () => {
  const v = flattenReport({
    Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Rev' }, { value: '$1,000,000.00' }] }] },
  });
  assert.equal(v[0].values[0], 1000000);
});
check('blank cells become null, not zero', () => {
  const v = flattenReport({
    Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Empty' }, { value: '' }] }] },
  });
  assert.equal(v[0].values[0], null);
});

console.log('\nFiscal periods');
const janPeriods = buildPeriods(fx.companyInfo, new Date('2026-08-03T00:00:00Z'));
check('calendar year starts in January', () =>
  assert.equal(janPeriods.current.start, '2026-01-01'));
check('prior YTD is the same span a year back', () => {
  assert.equal(janPeriods.priorYtd.start, '2025-01-01');
  assert.equal(janPeriods.priorYtd.end, '2025-08-03');
});
check('prior full year ends the day before FY start', () =>
  assert.equal(janPeriods.priorFull.end, '2025-12-31'));

const julPeriods = buildPeriods({ FiscalYearStartMonth: 'July' }, new Date('2026-08-03T00:00:00Z'));
check('July fiscal year rolls correctly', () => assert.equal(julPeriods.current.start, '2026-07-01'));
const junPeriods = buildPeriods({ FiscalYearStartMonth: 'October' }, new Date('2026-08-03T00:00:00Z'));
check('October fiscal year uses the prior calendar year', () =>
  assert.equal(junPeriods.current.start, '2025-10-01'));

console.log('\nDate range modes');
const asOf = new Date('2026-08-03T00:00:00Z');
check('twoYearYtd resolves both current and prior', () => {
  const p = resolvePeriods(fx.companyInfo, { mode: 'twoYearYtd' }, asOf);
  assert.equal(p.current.start, '2026-01-01');
  assert.ok(p.priorYtd && p.priorFull);
});
check('ytd mode has no prior comparison', () => {
  const p = resolvePeriods(fx.companyInfo, { mode: 'ytd' }, asOf);
  assert.equal(p.current.start, '2026-01-01');
  assert.equal(p.priorYtd, null);
  assert.equal(p.priorFull, null);
});
check('inception uses a fixed early floor, not CompanyStartDate, no prior', () => {
  // CompanyStartDate reflects when the QBO account was set up, not when the
  // business's actual records begin — a converted file can have real
  // transactions dated well before it. Confirmed live (see periods.js).
  const p = resolvePeriods({ ...fx.companyInfo, CompanyStartDate: '2015-03-10' }, { mode: 'inception' }, asOf);
  assert.equal(p.current.start, '1990-01-01');
  assert.equal(p.current.end, '2026-08-03');
  assert.equal(p.priorYtd, null);
});
check('custom range uses the given start/end verbatim, no prior', () => {
  const p = resolvePeriods(fx.companyInfo, { mode: 'custom', start: '2024-02-01', end: '2024-02-29' }, asOf);
  assert.equal(p.current.start, '2024-02-01');
  assert.equal(p.current.end, '2024-02-29');
  assert.equal(p.priorYtd, null);
});

console.log('\nQuery construction');
check('list query filters inactive correctly', () => {
  const customer = LIST_ENTITIES.find((e) => e.key === 'customers');
  assert.equal(countQuery(customer), 'select count(*) from Customer');
  assert.equal(
    countQuery(customer, { includeInactive: true }),
    'select count(*) from Customer where Active in (true, false)'
  );
});
check('list queries ignore date range — lists are always the file total', () => {
  const customer = LIST_ENTITIES.find((e) => e.key === 'customers');
  const dateRange = { start: '2022-01-01', end: '2024-12-31' };
  assert.equal(countQuery(customer, { dateRange }), 'select count(*) from Customer');
  assert.equal(
    countQuery(customer, { includeInactive: true, dateRange }),
    'select count(*) from Customer where Active in (true, false)'
  );
});
check('checks are Purchase filtered by PaymentType', () => {
  const checks = TRANSACTION_ENTITIES.find((e) => e.key === 'checks');
  assert.equal(countQuery(checks), "select count(*) from Purchase where PaymentType = 'Check'");
});
check('date range is appended to transaction queries', () => {
  const inv = TRANSACTION_ENTITIES.find((e) => e.key === 'invoices');
  assert.equal(
    countQuery(inv, { dateRange: { start: '2026-01-01', end: '2026-08-03' } }),
    "select count(*) from Invoice where TxnDate >= '2026-01-01' and TxnDate <= '2026-08-03'"
  );
});
check('transactions never get the Active filter', () => {
  const inv = TRANSACTION_ENTITIES.find((e) => e.key === 'invoices');
  assert.ok(!countQuery(inv, { includeInactive: true }).includes('Active'));
});
check('an open-ended dateRange (inception) omits the lower bound', () => {
  const inv = TRANSACTION_ENTITIES.find((e) => e.key === 'invoices');
  assert.equal(
    countQuery(inv, { dateRange: { end: '2026-08-03' } }),
    "select count(*) from Invoice where TxnDate <= '2026-08-03'"
  );
});
check('AR/AP chart breakouts filter Account by AccountType', () => {
  const ar = CHART_BREAKOUTS.find((e) => e.key === 'arAccounts');
  const ap = CHART_BREAKOUTS.find((e) => e.key === 'apAccounts');
  assert.equal(countQuery(ar), "select count(*) from Account where AccountType = 'Accounts Receivable'");
  assert.equal(countQuery(ap), "select count(*) from Account where AccountType = 'Accounts Payable'");
});

/* ---- exports ---- */

const sampleSummary = {
  realmId: '9341454792728053',
  generatedAt: new Date().toISOString(),
  durationMs: 8420,
  environment: 'sandbox',
  company: {
    name: fx.companyInfo.CompanyName,
    fiscalYearStartMonth: 'January',
  },
  periods: janPeriods,
  counts: {
    lists: LIST_ENTITIES.map((e, i) => ({
      key: e.key,
      label: e.label,
      group: e.group,
      entity: e.entity,
      status: i === 5 ? 'unavailable' : 'ok',
      note: i === 5 ? 'Not enabled on this company file' : null,
      active: i === 5 ? null : 20 + i * 7,
      inactive: i === 5 ? null : i,
      total: i === 5 ? null : 20 + i * 8,
    })),
    chartBreakouts: CHART_BREAKOUTS.map((e, i) => ({
      key: e.key,
      label: e.label,
      group: e.group,
      entity: e.entity,
      status: 'ok',
      note: null,
      active: 2 + i,
      inactive: 0,
      total: 2 + i,
    })),
    transactions: TRANSACTION_ENTITIES.map((e, i) => ({
      key: e.key,
      label: e.label,
      group: e.group,
      bucket: e.bucket,
      entity: e.entity,
      status: 'ok',
      note: null,
      total: 40 - i,
    })),
    get transactionBuckets() {
      return bucketTransactions(this.transactions);
    },
    get transactionLineBuckets() {
      // Fixture doesn't distinguish the two counting methods — reuse the
      // same rows, just to exercise the second Excel sheet's code path.
      return bucketTransactions(this.transactions);
    },
    totals: {
      listRecords: 412,
      inactiveRecords: 23,
      transactionRecords: 402,
      transactionLines: 460,
    },
    queriesIssued: 58,
  },
  financials: {
    profitAndLoss: {
      current: {
        period: janPeriods.current,
        accountingMethod: 'Accrual',
        revenue: 2753.55,
        costOfGoodsSold: 405,
        grossProfit: 2348.55,
        operatingExpenses: 1088.61,
        otherIncome: null,
        otherExpenses: null,
        netIncome: 1259.94,
        totalExpenses: 1493.61,
        topExpenseAccounts: [
          { label: 'Rent or Lease', amount: 900 },
          { label: 'Utilities', amount: 113.75 },
          { label: 'Advertising', amount: 74.86 },
        ],
      },
      priorYtd: {
        period: janPeriods.priorYtd,
        revenue: 3410.2,
        costOfGoodsSold: 520,
        grossProfit: 2890.2,
        operatingExpenses: 1510.4,
        netIncome: -140.2,
        totalExpenses: 2030.4,
        topExpenseAccounts: [],
      },
      priorFullYear: null,
    },
    receivables: {
      asOf: janPeriods.asOf,
      total: 5281.52,
      buckets: [
        { label: 'Current', amount: 1250 },
        { label: '1 - 30', amount: 2100.75 },
        { label: '31 - 60', amount: 810 },
        { label: '61 - 90', amount: 0 },
        { label: '91 and over', amount: 1120.77 },
      ],
    },
    payables: {
      asOf: janPeriods.asOf,
      total: 1602.67,
      buckets: [
        { label: 'Current', amount: 1200 },
        { label: '1 - 30', amount: 402.67 },
        { label: '31 - 60', amount: 0 },
        { label: '61 - 90', amount: 0 },
        { label: '91 and over', amount: 0 },
      ],
    },
    cash: {
      bankTotal: 3183.51,
      creditCardTotal: 457.24,
      netCash: 2726.27,
      accounts: [
        { id: '35', name: 'Checking', type: 'Bank', subType: 'Checking', balance: 1201.0, active: true },
        { id: '36', name: 'Savings', type: 'Bank', subType: 'Savings', balance: 1982.51, active: true },
        { id: '41', name: 'Mastercard', type: 'Credit Card', subType: 'CreditCard', balance: -457.24, active: true },
      ],
    },
    errors: [],
  },
  attachments: {
    total: 87, // sum(perEntity.links) + unlinked = (34+22+19+9) + 3
    totalAttachables: 88,
    documents: 74,
    notes: 14,
    unlinked: 3,
    totalBytes: 12_582_912,
    truncated: false,
    perEntity: [
      { type: 'Invoice', files: 31, links: 34 },
      { type: 'Bill', files: 22, links: 22 },
      { type: 'Purchase', files: 18, links: 19 },
      { type: 'Customer', files: 9, links: 9 },
    ],
  },
  comparisons: null,
  fileProfile: {
    chartOfAccounts: 63,
    bankAccounts: 2,
    creditCardAccounts: 1,
    multiCurrency: false,
    activeEmployees: 4,
    attachments: 88,
    classes: 5,
    locations: 0,
    trackedInventory: false,
    projects: true,
    estimates: 3,
    purchaseOrders: 0,
    fixedAssets: true,
    taxTracking: false,
    fiscalYearEnd: 'December',
  },
};

console.log('\nExports');
await fs.mkdir('./test/out', { recursive: true });

const xlsx = await buildExcel(sampleSummary);
await fs.writeFile('./test/out/sample-summary.xlsx', Buffer.from(xlsx));
check('workbook is written', () => assert.ok(xlsx.byteLength > 8000));

console.log(`\n${passed} checks passed. Sample exports in server/test/out/\n`);

import { qbo } from './client.js';
import { logger } from '../lib/logger.js';

const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : null;
};

const normalize = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * QBO reports arrive as arbitrarily deep Rows/Row trees. Rather than guessing
 * at the shape, flatten everything into a list of
 * { group, label, values[], depth } and pick lines out of that.
 */
export function flattenReport(report) {
  const out = [];

  const visit = (rows, depth) => {
    for (const row of rows?.Row ?? []) {
      const header = row.Header?.ColData;
      const summary = row.Summary?.ColData;
      const plain = row.ColData;

      const push = (cols, kind) => {
        if (!cols?.length) return;
        out.push({
          group: row.group ?? null,
          type: row.type ?? null,
          kind,
          depth,
          label: cols[0]?.value ?? '',
          accountId: cols[0]?.id ?? null,
          values: cols.slice(1).map((c) => num(c.value)),
        });
      };

      push(header, 'header');
      push(plain, 'row');
      if (row.Rows) visit(row.Rows, depth + 1);
      push(summary, 'summary');
    }
  };

  visit(report?.Rows, 0);
  return out;
}

/**
 * Find a value by QBO `group` first (stable), falling back to matching the
 * row label (needed because some report variants only label the summary line).
 */
function pick(lines, { groups = [], labels = [], column = 0 }) {
  for (const g of groups) {
    const hit = lines.find((l) => l.group === g && l.values.some((v) => v !== null));
    if (hit) return hit.values[column] ?? null;
  }
  const wanted = labels.map(normalize);
  for (const w of wanted) {
    const hit = lines.find((l) => normalize(l.label) === w && l.values.some((v) => v !== null));
    if (hit) return hit.values[column] ?? null;
  }
  return null;
}

function columnLabels(report) {
  return (report?.Columns?.Column ?? []).map((c) => c.ColTitle).slice(1);
}

/* ------------------------------------------------------------------ */
/* Profit & Loss                                                       */
/* ------------------------------------------------------------------ */

export async function fetchProfitAndLoss(realmId, period, { accountingMethod } = {}) {
  const report = await qbo.report(realmId, 'ProfitAndLoss', {
    start_date: period.start,
    end_date: period.end,
    accounting_method: accountingMethod,
  });
  const lines = flattenReport(report);

  const income = pick(lines, { groups: ['Income'], labels: ['Total Income'] });
  const cogs = pick(lines, { groups: ['COGS'], labels: ['Total Cost of Goods Sold'] });
  const grossProfit = pick(lines, { groups: ['GrossProfit'], labels: ['Gross Profit'] });
  const expenses = pick(lines, { groups: ['Expenses'], labels: ['Total Expenses'] });
  const otherIncome = pick(lines, { groups: ['OtherIncome'], labels: ['Total Other Income'] });
  const otherExpenses = pick(lines, { groups: ['OtherExpenses'], labels: ['Total Other Expenses'] });
  const netIncome = pick(lines, { groups: ['NetIncome'], labels: ['Net Income', 'Profit'] });

  // Top expense categories make the dashboard immediately useful.
  const topExpenses = lines
    .filter((l) => l.kind === 'row' && l.accountId && (l.values[0] ?? 0) > 0)
    .map((l) => ({ label: l.label, amount: l.values[0] }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  return {
    period,
    currency: report?.Header?.Currency ?? null,
    accountingMethod: report?.Header?.ReportBasis ?? accountingMethod ?? null,
    revenue: income,
    costOfGoodsSold: cogs,
    grossProfit: grossProfit ?? (income !== null && cogs !== null ? income - cogs : null),
    operatingExpenses: expenses,
    otherIncome,
    otherExpenses,
    netIncome,
    totalExpenses:
      expenses !== null || cogs !== null ? (expenses ?? 0) + (cogs ?? 0) + (otherExpenses ?? 0) : null,
    topExpenseAccounts: topExpenses,
  };
}

/* ------------------------------------------------------------------ */
/* AR / AP aging                                                       */
/* ------------------------------------------------------------------ */

async function fetchAging(realmId, reportName, asOfDate) {
  const report = await qbo.report(realmId, reportName, { report_date: asOfDate });
  const lines = flattenReport(report);
  const buckets = columnLabels(report);

  const totalRow =
    lines.find((l) => l.kind === 'summary' && normalize(l.label).startsWith('total')) ??
    lines.filter((l) => l.kind === 'summary').at(-1);

  const values = totalRow?.values ?? [];
  return {
    asOf: asOfDate,
    total: values.at(-1) ?? null,
    buckets: buckets.map((label, i) => ({ label, amount: values[i] ?? null })).slice(0, -1),
  };
}

export const fetchArAging = (realmId, asOf) => fetchAging(realmId, 'AgedReceivables', asOf);
export const fetchApAging = (realmId, asOf) => fetchAging(realmId, 'AgedPayables', asOf);

/* ------------------------------------------------------------------ */
/* Cash position — read straight off the chart of accounts             */
/* ------------------------------------------------------------------ */

export async function fetchCashPosition(realmId) {
  const accounts = await qbo.queryAll(realmId, 'Account', {
    where: "AccountType in ('Bank', 'Credit Card')",
  });

  const bank = accounts.filter((a) => a.AccountType === 'Bank');
  const cards = accounts.filter((a) => a.AccountType === 'Credit Card');
  const total = (rows) => rows.reduce((s, a) => s + Number(a.CurrentBalance ?? 0), 0);

  return {
    bankTotal: total(bank),
    creditCardTotal: total(cards),
    netCash: total(bank) - total(cards),
    accounts: [...bank, ...cards].map((a) => ({
      id: a.Id,
      name: a.Name,
      type: a.AccountType,
      subType: a.AccountSubType,
      balance: Number(a.CurrentBalance ?? 0),
      active: a.Active !== false,
    })),
  };
}

/* ------------------------------------------------------------------ */

const settled = async (label, fn) => {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    logger.warn(`Report "${label}" failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
};

// 'ytd', 'inception' and 'custom' modes have no meaningful prior period —
// skip those fetches entirely rather than pass a null period downstream.
const none = async () => ({ ok: true, data: null });

/** Phase 2 payload: every financial figure the dashboard needs, in parallel. */
export async function fetchFinancials(realmId, periods, options = {}) {
  const [current, priorYtd, priorFull, ar, ap, cash] = await Promise.all([
    settled('P&L current', () => fetchProfitAndLoss(realmId, periods.current, options)),
    periods.priorYtd
      ? settled('P&L prior YTD', () => fetchProfitAndLoss(realmId, periods.priorYtd, options))
      : none(),
    periods.priorFull
      ? settled('P&L prior full', () => fetchProfitAndLoss(realmId, periods.priorFull, options))
      : none(),
    settled('AR aging', () => fetchArAging(realmId, periods.asOf)),
    settled('AP aging', () => fetchApAging(realmId, periods.asOf)),
    settled('Cash position', () => fetchCashPosition(realmId)),
  ]);

  const unwrap = (r) => (r.ok ? r.data : null);
  const errors = [current, priorYtd, priorFull, ar, ap, cash].filter((r) => !r.ok).map((r) => r.error);

  return {
    profitAndLoss: {
      current: unwrap(current),
      priorYtd: unwrap(priorYtd),
      priorFullYear: unwrap(priorFull),
    },
    receivables: unwrap(ar),
    payables: unwrap(ap),
    cash: unwrap(cash),
    errors,
  };
}

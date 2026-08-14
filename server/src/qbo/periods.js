const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const iso = (d) => d.toISOString().slice(0, 10);

export function fiscalStartMonthIndex(companyInfo) {
  const name = companyInfo?.FiscalYearStartMonth;
  const idx = MONTHS.findIndex((m) => m.toLowerCase() === String(name ?? '').toLowerCase());
  return idx === -1 ? 0 : idx; // default to January
}

/**
 * Builds the three periods the dashboard compares:
 *  - current   : fiscal year start → today (year to date)
 *  - priorYtd  : the same span one year earlier, for a like-for-like read
 *  - priorFull : the whole previous fiscal year
 */
export function buildPeriods(companyInfo, asOf = new Date()) {
  const startMonth = fiscalStartMonthIndex(companyInfo);
  const today = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));

  const startYear =
    today.getUTCMonth() >= startMonth ? today.getUTCFullYear() : today.getUTCFullYear() - 1;

  const fyStart = new Date(Date.UTC(startYear, startMonth, 1));
  const priorStart = new Date(Date.UTC(startYear - 1, startMonth, 1));
  const priorEndSameDay = new Date(
    Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate())
  );
  const priorFullEnd = new Date(Date.UTC(startYear, startMonth, 1) - 86_400_000);

  return {
    fiscalYearStartMonth: MONTHS[startMonth],
    current: { label: `FY${startYear} to date`, start: iso(fyStart), end: iso(today) },
    priorYtd: {
      label: `FY${startYear - 1} same period`,
      start: iso(priorStart),
      end: iso(priorEndSameDay),
    },
    priorFull: {
      label: `FY${startYear - 1} full year`,
      start: iso(priorStart),
      end: iso(priorFullEnd),
    },
    asOf: iso(today),
  };
}

/**
 * Resolves whichever date range mode the dashboard asked for into the same
 * { current, priorYtd, priorFull, asOf } shape reports/counts already expect.
 * Only 'twoYearYtd' (the historical default) populates priorYtd/priorFull —
 * 'ytd', 'inception' and 'custom' show a single range with no comparison,
 * since "prior period" isn't a meaningful concept for them.
 */
export function resolvePeriods(companyInfo, range = { mode: 'twoYearYtd' }, asOf = new Date()) {
  const base = buildPeriods(companyInfo, asOf);
  const mode = range?.mode ?? 'twoYearYtd';

  if (mode === 'twoYearYtd') {
    return { mode, fiscalYearStartMonth: base.fiscalYearStartMonth, ...base };
  }

  if (mode === 'ytd') {
    return {
      mode,
      fiscalYearStartMonth: base.fiscalYearStartMonth,
      current: base.current,
      priorYtd: null,
      priorFull: null,
      asOf: base.asOf,
    };
  }

  if (mode === 'inception') {
    // Deliberately NOT company.CompanyStartDate — on a converted/migrated
    // file that date reflects when the QBO account itself was set up, not
    // when the business's records actually begin. Confirmed live: one file
    // had CompanyStartDate of 2016-10-05 but real transactions dated back to
    // 2005-07-01, silently excluding ~4,000 records from "since inception."
    // A fixed early floor guarantees nothing real predates it, without
    // needing an extra query just to find the true earliest transaction.
    return {
      mode,
      fiscalYearStartMonth: base.fiscalYearStartMonth,
      current: { label: 'Since inception', start: '1990-01-01', end: base.asOf },
      priorYtd: null,
      priorFull: null,
      asOf: base.asOf,
    };
  }

  // custom
  return {
    mode,
    fiscalYearStartMonth: base.fiscalYearStartMonth,
    current: { label: `${range.start} – ${range.end}`, start: range.start, end: range.end },
    priorYtd: null,
    priorFull: null,
    asOf: base.asOf,
  };
}

export { iso as toIsoDate };

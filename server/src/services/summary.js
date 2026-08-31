import { qbo } from '../qbo/client.js';
import { fetchCounts } from '../qbo/counts.js';
import { fetchFinancials } from '../qbo/reports.js';
import { fetchAttachments } from '../qbo/attachments.js';
import { fetchFileProfile } from '../qbo/profile.js';
import { resolvePeriods } from '../qbo/periods.js';
import { fetchEarliestTransactionDate } from '../qbo/earliestTransactionDate.js';
import { store } from '../lib/store.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';

const variance = (current, prior) => {
  if (current === null || current === undefined || prior === null || prior === undefined) {
    return { amount: null, percent: null };
  }
  const amount = current - prior;
  const percent = prior === 0 ? null : (amount / Math.abs(prior)) * 100;
  return { amount, percent };
};

function buildComparisons(financials) {
  const cur = financials.profitAndLoss.current;
  const prior = financials.profitAndLoss.priorYtd;
  if (!cur || !prior) return null;

  return {
    basis: `${cur.period.label} vs ${prior.period.label}`,
    revenue: { current: cur.revenue, prior: prior.revenue, ...variance(cur.revenue, prior.revenue) },
    expenses: {
      current: cur.totalExpenses,
      prior: prior.totalExpenses,
      ...variance(cur.totalExpenses, prior.totalExpenses),
    },
    netIncome: {
      current: cur.netIncome,
      prior: prior.netIncome,
      ...variance(cur.netIncome, prior.netIncome),
    },
    grossMargin: {
      current: cur.revenue ? ((cur.grossProfit ?? 0) / cur.revenue) * 100 : null,
      prior: prior.revenue ? ((prior.grossProfit ?? 0) / prior.revenue) * 100 : null,
    },
  };
}

// Cache key needs to distinguish ranges, not just companies — a 'custom'
// range is keyed by its own dates; the three fixed modes just need their name
// (the existing TTL already handles staleness as today rolls into tomorrow).
function cacheKey(realmId, range) {
  const mode = range?.mode ?? 'twoYearYtd';
  if (mode === 'custom') return `${realmId}:custom:${range.start}:${range.end}`;
  return `${realmId}:${mode}`;
}

/**
 * Runs every phase and assembles the full company summary.
 * `onProgress` lets the HTTP layer stream stage updates to the browser.
 */
export async function generateSummary(
  realmId,
  { onProgress = () => {}, onCounts = () => {}, accountingMethod, range } = {}
) {
  const startedAt = Date.now();

  onProgress({ stage: 'company', message: 'Reading company profile' });
  const company = await qbo.companyInfo(realmId);
  const periods = resolvePeriods(company, range);

  onProgress({ stage: 'counts', message: 'Counting lists and transactions' });
  const [counts, earliestDataDate] = await Promise.all([
    fetchCounts(realmId, { range: periods.current }),
    // Only meaningful for "Since inception" — every other mode already has
    // an explicit chosen start date, so there's nothing to look up. Soft-
    // fails to null: this is a display nicety, not worth sinking the build.
    periods.mode === 'inception'
      ? fetchEarliestTransactionDate(realmId).catch((err) => {
          logger.warn(`Earliest transaction date lookup failed: ${err.message}`);
          return null;
        })
      : Promise.resolve(null),
  ]);
  if (earliestDataDate) periods.current.actualStart = earliestDataDate;
  onCounts(counts);

  onProgress({ stage: 'financials', message: 'Pulling financial reports' });
  const financials = await fetchFinancials(realmId, periods, { accountingMethod });

  onProgress({ stage: 'attachments', message: 'Scanning attachments' });
  let attachments = null;
  try {
    attachments = await fetchAttachments(realmId, { range: periods.current });
  } catch (err) {
    logger.warn(`Attachment scan failed: ${err.message}`);
    financials.errors.push(`Attachments: ${err.message}`);
  }

  let fileProfile = null;
  try {
    fileProfile = await fetchFileProfile(realmId, {
      financials,
      fiscalYearStartMonth: periods.fiscalYearStartMonth,
    });
  } catch (err) {
    logger.warn(`File profile fetch failed: ${err.message}`);
    financials.errors.push(`File profile: ${err.message}`);
  }

  const summary = {
    realmId,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    environment: config.qbo.environment,
    company: {
      name: company.CompanyName ?? 'Unknown company',
      legalName: company.LegalName ?? null,
      country: company.Country ?? null,
      fiscalYearStartMonth: periods.fiscalYearStartMonth,
      createdAt: company.MetaData?.CreateTime ?? null,
      email: company.Email?.Address ?? null,
    },
    periods,
    counts,
    financials,
    attachments,
    fileProfile,
  };

  summary.comparisons = buildComparisons(financials);

  await store.set('summaries', cacheKey(realmId, range), summary);
  onProgress({ stage: 'done', message: 'Summary ready' });
  logger.info(`Summary for ${realmId} (${periods.mode}) built in ${summary.durationMs}ms`);
  return summary;
}

/** Returns the cached summary, rebuilding it when stale or when forced. */
export async function getSummary(realmId, { force = false, range, ...options } = {}) {
  if (!force) {
    const cached = await store.get('summaries', cacheKey(realmId, range));
    if (cached && Date.now() - new Date(cached.generatedAt).getTime() < config.cache.ttlMs) {
      return { ...cached, fromCache: true };
    }
  }
  return generateSummary(realmId, { range, ...options });
}

export async function getCachedSummary(realmId, range) {
  return store.get('summaries', cacheKey(realmId, range));
}

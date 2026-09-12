import { qbo } from './client.js';
import { TRANSACTION_ENTITIES } from './catalog.js';
import { logger } from '../lib/logger.js';

// Distinct entities only — Purchase appears 3x in TRANSACTION_ENTITIES (split
// by PaymentType for bucketing on the results screen), but that split
// doesn't matter here; querying it 3 times would just waste a call.
const ENTITIES = [...new Set(TRANSACTION_ENTITIES.map((s) => s.entity))];

async function extremeDate(realmId, entity, direction, range) {
  const clauses = [];
  if (range?.start) clauses.push(`TxnDate >= '${range.start}'`);
  if (range?.end) clauses.push(`TxnDate <= '${range.end}'`);
  const where = clauses.length ? ` where ${clauses.join(' and ')}` : '';

  try {
    const res = await qbo.query(
      realmId,
      `select TxnDate from ${entity}${where} orderby TxnDate ${direction} maxresults 1`
    );
    return res?.[entity]?.[0]?.TxnDate ?? null;
  } catch (err) {
    // An entity that's off for this company (e.g. Transfer never used)
    // errors here rather than returning empty — not fatal, just skip it.
    logger.warn(`${direction === 'asc' ? 'Earliest' : 'Latest'}-date lookup skipped ${entity} for ${realmId}: ${err.message}`);
    return null;
  }
}

/**
 * The real first AND last transaction dates within `range`, across every
 * transaction type — not just the range's own stated boundaries.
 *
 * Matters for every mode, not only "Since inception": a selected range's
 * start/end are the window you asked for, not proof anything actually
 * happened right on those exact days. "Since inception" has the most
 * extreme case (a fixed 1990-01-01 floor, deliberately not a real date —
 * see periods.js, so a converted file's real history can never fall
 * outside it even if this lookup or QBO's own stated company-start-date
 * is wrong), but the same idea applies to a YTD or custom range that
 * starts before the file's real first transaction in that window, or ends
 * after its last one (a dormant stretch).
 *
 * Both directions run together in one batch of parallel calls (28 for a
 * 14-entity file: earliest + latest per entity), not as two separate
 * sequential passes.
 */
export async function fetchTransactionDateRange(realmId, range) {
  const [earliestByEntity, latestByEntity] = await Promise.all([
    Promise.all(ENTITIES.map((entity) => extremeDate(realmId, entity, 'asc', range))),
    Promise.all(ENTITIES.map((entity) => extremeDate(realmId, entity, 'desc', range))),
  ]);

  const earliest = earliestByEntity.filter(Boolean).sort();
  const latest = latestByEntity.filter(Boolean).sort();

  return {
    earliest: earliest[0] ?? null,
    latest: latest[latest.length - 1] ?? null,
  };
}

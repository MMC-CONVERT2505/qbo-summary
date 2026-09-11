import { qbo } from './client.js';
import { TRANSACTION_ENTITIES } from './catalog.js';
import { logger } from '../lib/logger.js';

// Distinct entities only — Purchase appears 3x in TRANSACTION_ENTITIES (split
// by PaymentType for bucketing on the results screen), but that split
// doesn't matter here; querying it 3 times would just waste a call.
const ENTITIES = [...new Set(TRANSACTION_ENTITIES.map((s) => s.entity))];

async function extremeDate(realmId, entity, direction) {
  try {
    const res = await qbo.query(realmId, `select TxnDate from ${entity} orderby TxnDate ${direction} maxresults 1`);
    return res?.[entity]?.[0]?.TxnDate ?? null;
  } catch (err) {
    // An entity that's off for this company (e.g. Transfer never used)
    // errors here rather than returning empty — not fatal, just skip it.
    logger.warn(`${direction === 'asc' ? 'Earliest' : 'Latest'}-date lookup skipped ${entity} for ${realmId}: ${err.message}`);
    return null;
  }
}

/**
 * The real first AND last transaction dates in the file, across every
 * transaction type. "Since inception" mode itself deliberately does NOT use
 * either of these for its own query range — it queries from a fixed
 * 1990-01-01 floor through today instead (see periods.js), so a converted
 * file's real history can never fall outside the range even if this lookup
 * or QBO's own stated company-start-date is wrong. This is purely for
 * display: "Since inception (through today)" doesn't tell you the file's
 * real first transaction, and — just as easily missed — doesn't tell you
 * the file might be dormant, with its real last transaction months back.
 *
 * Both directions run together in one batch of parallel calls (28 for a
 * 14-entity file: earliest + latest per entity), not as two separate
 * sequential passes.
 */
export async function fetchTransactionDateRange(realmId) {
  const [earliestByEntity, latestByEntity] = await Promise.all([
    Promise.all(ENTITIES.map((entity) => extremeDate(realmId, entity, 'asc'))),
    Promise.all(ENTITIES.map((entity) => extremeDate(realmId, entity, 'desc'))),
  ]);

  const earliest = earliestByEntity.filter(Boolean).sort();
  const latest = latestByEntity.filter(Boolean).sort();

  return {
    earliest: earliest[0] ?? null,
    latest: latest[latest.length - 1] ?? null,
  };
}

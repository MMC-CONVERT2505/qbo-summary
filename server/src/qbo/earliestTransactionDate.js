import { qbo } from './client.js';
import { TRANSACTION_ENTITIES } from './catalog.js';
import { logger } from '../lib/logger.js';

// Distinct entities only — Purchase appears 3x in TRANSACTION_ENTITIES (split
// by PaymentType for bucketing on the results screen), but that split
// doesn't matter here; querying it 3 times would just waste a call.
const ENTITIES = [...new Set(TRANSACTION_ENTITIES.map((s) => s.entity))];

/**
 * The real earliest transaction date in the file, across every transaction
 * type. "Since inception" mode itself deliberately does NOT use this — it
 * queries from a fixed 1990-01-01 floor instead (see periods.js), so a
 * converted file's real history can never fall outside the range even if
 * this lookup or QBO's own stated company-start-date is wrong. This is
 * purely for display — telling the user what date their data actually
 * starts from, since "Since inception" alone doesn't say.
 */
export async function fetchEarliestTransactionDate(realmId) {
  const dates = await Promise.all(
    ENTITIES.map(async (entity) => {
      try {
        const res = await qbo.query(realmId, `select TxnDate from ${entity} orderby TxnDate asc maxresults 1`);
        return res?.[entity]?.[0]?.TxnDate ?? null;
      } catch (err) {
        // An entity that's off for this company (e.g. Transfer never used)
        // errors here rather than returning empty — not fatal, just skip it.
        logger.warn(`Earliest-date lookup skipped ${entity} for ${realmId}: ${err.message}`);
        return null;
      }
    })
  );

  const found = dates.filter(Boolean).sort();
  return found[0] ?? null;
}

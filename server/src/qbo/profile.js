import { qbo } from './client.js';
import { PROFILE_ENTITIES, LIST_ENTITIES, TRANSACTION_ENTITIES, countQuery } from './catalog.js';
import { logger } from '../lib/logger.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Month name the fiscal year ends in, given the month it starts in. */
function fiscalYearEndMonth(startMonth) {
  const i = MONTHS.indexOf(startMonth);
  return i >= 0 ? MONTHS[(i + 11) % 12] : null;
}

const find = (specs, key) => specs.find((s) => s.key === key);

// Whole-file facts, deliberately unscoped — "how many accounts does this file
// have" shouldn't shrink to "how many were created in the selected period."
// That MetaData.CreateTime scoping is correct for the main counts screen
// (which is about the selected period) but wrong for a profile checklist
// (which is about the file as a whole, same idea as the inventory/fixed
// asset/project checks below).
//
// Total (active + inactive) — the checklist asks "how big is this file,"
// not "how much of it is currently active."
const PROFILE_LIST_TOTAL_KEYS = ['accounts', 'classes', 'departments', 'currencies'];
// Active-only — the checklist explicitly asks for "Active Employees."
const PROFILE_LIST_ACTIVE_KEYS = ['employees'];
const PROFILE_TXN_KEYS = ['estimates', 'purchaseOrders'];

/**
 * The "file profile" checklist used to scope a review before diving in —
 * COA size, which optional features are in use, fiscal year end. Every
 * figure here is a point-in-time fact about the whole file, so every query
 * this issues is unscoped, unlike `fetchCounts()`'s period-scoped ones.
 */
export async function fetchFileProfile(realmId, { financials, fiscalYearStartMonth }) {
  const items = [
    ...PROFILE_ENTITIES.map((spec) => ({ id: spec.key, query: countQuery(spec) })),
    ...PROFILE_LIST_TOTAL_KEYS.map((key) => {
      const spec = find(LIST_ENTITIES, key);
      return { id: `list:${key}`, query: countQuery(spec, { includeInactive: true }) };
    }),
    ...PROFILE_LIST_ACTIVE_KEYS.map((key) => {
      const spec = find(LIST_ENTITIES, key);
      return { id: `list:${key}`, query: countQuery(spec) };
    }),
    ...PROFILE_TXN_KEYS.map((key) => {
      const spec = find(TRANSACTION_ENTITIES, key);
      return { id: `txn:${key}`, query: countQuery(spec) };
    }),
    { id: 'attachables', query: 'select count(*) from Attachable' },
  ];
  const results = await qbo.batchQuery(realmId, items);

  const readCount = (key) => {
    const r = results[key];
    return r?.ok ? Number(r.totalCount ?? 0) : null;
  };

  const inventoryItems = readCount('inventoryItems');
  const fixedAssetAccounts = readCount('fixedAssetAccounts');
  const projects = readCount('projects');
  const accounts = readCount('list:accounts');
  const employees = readCount('list:employees');
  const classes = readCount('list:classes');
  const departments = readCount('list:departments');
  const currencies = readCount('list:currencies');
  const estimates = readCount('txn:estimates');
  const purchaseOrders = readCount('txn:purchaseOrders');
  const attachments = readCount('attachables');

  let taxTracking = null;
  try {
    const prefs = await qbo.preferences(realmId);
    taxTracking = prefs?.TaxPrefs?.UsingSalesTax ?? null;
  } catch (err) {
    logger.warn(`Could not read tax preferences for ${realmId}: ${err.message}`);
  }

  const bankAccounts = financials.cash?.accounts?.filter((a) => a.type === 'Bank').length ?? null;
  const creditCardAccounts = financials.cash?.accounts?.filter((a) => a.type === 'Credit Card').length ?? null;

  return {
    chartOfAccounts: accounts,
    bankAccounts,
    creditCardAccounts,
    multiCurrency: currencies === null ? null : currencies > 1,
    activeEmployees: employees,
    attachments,
    classes,
    locations: departments,
    trackedInventory: inventoryItems === null ? null : inventoryItems > 0,
    projects: projects === null ? null : projects > 0,
    estimates,
    purchaseOrders,
    fixedAssets: fixedAssetAccounts === null ? null : fixedAssetAccounts > 0,
    taxTracking,
    fiscalYearEnd: fiscalYearEndMonth(fiscalYearStartMonth),
  };
}

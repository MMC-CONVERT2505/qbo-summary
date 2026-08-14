/**
 * Accounting conventions, applied consistently:
 * negatives in parentheses, thousands separated, em dash for "no value".
 */
const DASH = '—';

export function money(value, { decimals = 2, currency = '' } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  const abs = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const body = currency ? `${currency}${abs}` : abs;
  return value < 0 ? `(${body})` : body;
}

export function compactMoney(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  const abs = Math.abs(value);
  const unit = abs >= 1e9 ? ['B', 1e9] : abs >= 1e6 ? ['M', 1e6] : abs >= 1e4 ? ['K', 1e3] : ['', 1];
  const n = (abs / unit[1]).toFixed(unit[1] === 1 ? 0 : 1).replace(/\.0$/, '');
  const body = `${n}${unit[0]}`;
  return value < 0 ? `(${body})` : body;
}

export function count(value) {
  if (value === null || value === undefined) return DASH;
  return Number(value).toLocaleString();
}

export function percent(value, { signed = true, decimals = 1 } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function dateLabel(iso) {
  if (!iso) return DASH;
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function relativeTime(iso) {
  if (!iso) return DASH;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** Class name for a figure so negatives read red without extra markup. */
export const figClass = (v) =>
  `fig${typeof v === 'number' && v < 0 ? ' fig--neg' : ''}`;

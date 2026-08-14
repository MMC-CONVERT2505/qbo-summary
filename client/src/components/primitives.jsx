import Odometer from './Odometer.jsx';
import { figClass } from '../lib/format.js';

export function Section({ title, note, action, children }) {
  return (
    <section className="section">
      <div className="section__head">
        <h2>{title}</h2>
        {note && <span className="section__note">{note}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}

export function StatBand({ stats }) {
  return (
    <div className="statband">
      {stats.map((s) => {
        const empty = !s.isCount && (s.raw === null || s.raw === undefined);
        return (
          <div className="stat" key={s.label}>
            <div className="stat__label">{s.label}</div>
            {empty ? (
              <div className="stat__empty">No data</div>
            ) : (
              <div className={`stat__value ${figClass(s.raw)}`}>
                {s.isCount ? <Odometer value={s.raw ?? 0} /> : s.value}
              </div>
            )}
            {s.sub && <div className="stat__sub">{s.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The green-bar table. Columns declare their own alignment and formatter so
 * every figure lands in the monospaced, tabular-numeral treatment without
 * each caller re-deciding.
 */
export function Ledger({ columns, rows, rowKey, emptyMessage = 'Nothing to show.' }) {
  if (!rows?.length) return <div className="ledger-wrap"><p className="empty">{emptyMessage}</p></div>;

  return (
    <div className="ledger-wrap">
      <table className="ledger">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'num' : undefined} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row, i) : i}
              className={[row.__total && 'is-total', row.__muted && 'is-muted']
                .filter(Boolean)
                .join(' ')}
            >
              {columns.map((c) => {
                const raw = row[c.key];
                const numeric = c.align === 'right';
                return (
                  <td key={c.key} className={numeric ? 'num' : undefined}>
                    <span className={numeric ? figClass(raw) : c.className}>
                      {c.render ? c.render(raw, row) : (raw ?? '—')}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          className="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

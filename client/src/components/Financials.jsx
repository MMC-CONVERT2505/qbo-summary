import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { Section, Ledger } from './primitives.jsx';
import { money, compactMoney, percent, figClass } from '../lib/format.js';

const LEDGER = '#2f6b4f';
const RED = '#a8322d';
const RULE = '#c7d6c3';

const axis = { fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, fill: '#6b7a85' };

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${RULE}`,
        borderRadius: 3,
        padding: '8px 11px',
        fontSize: 12,
        boxShadow: '0 4px 14px -8px rgb(20 32 43 / 40%)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 3 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ fontFamily: 'IBM Plex Mono, monospace' }}>
          {p.name}: {money(p.value)}
        </div>
      ))}
    </div>
  );
}

function ComparisonTable({ pl }) {
  const hasPrior = Boolean(pl.priorYtd);
  const lines = [
    ['Revenue', 'revenue'],
    ['Cost of goods sold', 'costOfGoodsSold'],
    ['Gross profit', 'grossProfit'],
    ['Operating expenses', 'operatingExpenses'],
    ['Other income', 'otherIncome'],
    ['Other expenses', 'otherExpenses'],
    ['Net income', 'netIncome'],
  ];

  const rows = lines.map(([label, key], i) => {
    const current = pl.current?.[key] ?? null;
    const prior = pl.priorYtd?.[key] ?? null;
    const change = current !== null && prior !== null ? current - prior : null;
    return {
      label,
      current,
      prior,
      change,
      pct: current !== null && prior ? ((current - prior) / Math.abs(prior)) * 100 : null,
      __total: i === lines.length - 1,
    };
  });

  return (
    <Ledger
      rowKey={(r) => r.label}
      rows={rows}
      columns={[
        { key: 'label', header: 'Line' },
        {
          key: 'current',
          header: pl.current?.period.label ?? 'Current',
          align: 'right',
          render: (v) => money(v),
        },
        // No prior period for ytd/inception/custom modes — showing an
        // all-dashes "Prior year" column there would just be noise.
        ...(hasPrior
          ? [
              { key: 'prior', header: pl.priorYtd.period.label, align: 'right', render: (v) => money(v) },
              { key: 'change', header: 'Change', align: 'right', render: (v) => money(v) },
              { key: 'pct', header: '%', align: 'right', render: (v) => percent(v) },
            ]
          : []),
      ]}
    />
  );
}

function AgingChart({ title, data }) {
  if (!data?.buckets?.length) return null;
  const chart = data.buckets.map((b) => ({ bucket: b.label, amount: b.amount ?? 0 }));
  const oldestIndex = chart.length - 1;

  return (
    <div className="card">
      <h3 className="card__title">{title}</h3>
      <div style={{ fontSize: 26, fontWeight: 600, marginBottom: 12 }} className={figClass(data.total)}>
        {money(data.total)}
      </div>
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={chart} margin={{ top: 14, right: 6, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="#eef2ec" />
          <XAxis dataKey="bucket" tick={axis} axisLine={{ stroke: RULE }} tickLine={false} />
          <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={compactMoney} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f2f6f0' }} />
          <Bar dataKey="amount" name="Outstanding" radius={[2, 2, 0, 0]}>
            {chart.map((entry, i) => (
              // The oldest bucket is the one that costs money, so it reads in red ink.
              <Cell key={entry.bucket} fill={i === oldestIndex && entry.amount > 0 ? RED : LEDGER} />
            ))}
            <LabelList
              dataKey="amount"
              position="top"
              formatter={compactMoney}
              style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, fill: '#6b7a85' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Profit and loss + Open receivables/payables are deliberately hidden for
// now (not deleted) — revisit placement/design later. ComparisonTable and
// AgingChart above are kept intact so restoring this is a one-line swap.
export default function Financials(/* { financials } */) {
  return null;

  /*
  const pl = financials.profitAndLoss;
  return (
    <>
      {pl.current ? (
        <Section
          title="Profit and loss"
          note={pl.current.accountingMethod ? `${pl.current.accountingMethod} basis` : undefined}
        >
          <ComparisonTable pl={pl} />
        </Section>
      ) : (
        <Section title="Profit and loss">
          <div className="ledger-wrap">
            <p className="empty">The profit and loss report did not come back. Refresh to try again.</p>
          </div>
        </Section>
      )}

      <Section title="Open receivables and payables" note={`As of ${financials.receivables?.asOf ?? '—'}`}>
        <div className="grid grid--2">
          <AgingChart title="Receivables outstanding" data={financials.receivables} />
          <AgingChart title="Payables outstanding" data={financials.payables} />
        </div>
      </Section>
    </>
  );
  */
}

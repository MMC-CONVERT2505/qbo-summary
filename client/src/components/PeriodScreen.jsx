import { useState } from 'react';
import AppBar from './AppBar.jsx';

const RANGE_MODES = [
  ['ytd', 'YTD', 'Current Financial Year'],
  ['twoYearYtd', '1Y + YTD', 'Current Financial Year + Last Financial Year'],
  ['inception', 'Inception to date', 'Everything in the file, from when the company started'],
  ['custom', 'Custom Date Range', 'Choose your own start and end dates'],
];

/**
 * Full-screen period picker — reachable right after connecting, and again
 * via "Change period" from the results screen. The company name comes from
 * `status.companyName` (a lightweight companyinfo call the /status endpoint
 * makes) until a full summary exists, then prefers the summary's own copy.
 */
export default function PeriodScreen({ summary, status, range, onApply, onBack, busy }) {
  const [mode, setMode] = useState(range.mode ?? 'twoYearYtd');
  const [start, setStart] = useState(range.start ?? '');
  const [end, setEnd] = useState(range.end ?? '');

  const apply = () => {
    if (mode === 'custom') {
      if (!start || !end) return;
      onApply({ mode: 'custom', start, end });
    } else {
      onApply({ mode });
    }
  };

  return (
    <section className="screen">
      <div className="wrap">
        <AppBar />
        <div className="bar">
          <div className="who">
            {summary?.company?.name ?? status?.companyName ?? 'Connected company'}
            <span>
              Realm {summary?.realmId ?? status?.realmId} · {status?.environment}
              {summary?.company?.fiscalYearStartMonth && ` · fiscal year starts ${summary.company.fiscalYearStartMonth}`}
            </span>
          </div>
          <button className="ghost" type="button" onClick={onBack}>Use a different company</button>
        </div>

        <div className="eyebrow">Choose a period</div>
        <h2 style={{ fontFamily: 'var(--display)', fontWeight: 500, fontSize: 27, margin: '12px 0 0' }}>
          Which period should I count?
        </h2>
        <p className="lede" style={{ fontSize: '15.5px' }}>
          Transaction counts and "created in range" list figures cover records dated inside the
          range. Financial reports use the same span.
        </p>

        <div className="picks">
          {RANGE_MODES.map(([m, label, desc]) => (
            <button
              key={m}
              type="button"
              className={`pick ${mode === m ? 'on' : ''}`}
              onClick={() => setMode(m)}
            >
              <h3>{label}</h3>
              <p>{desc}</p>
            </button>
          ))}
        </div>

        {mode === 'custom' && (
          <div className="custom">
            <div className="field">
              <label htmlFor="range-start">From</label>
              <input
                id="range-start"
                type="date"
                value={start}
                max={end || undefined}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="range-end">To</label>
              <input
                id="range-end"
                type="date"
                value={end}
                min={start || undefined}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
        )}

        <button
          className="btn"
          type="button"
          onClick={apply}
          disabled={busy || (mode === 'custom' && (!start || !end))}
        >
          {busy ? 'Counting…' : 'Apply and count'}
        </button>
      </div>
    </section>
  );
}

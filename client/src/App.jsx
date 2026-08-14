import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { count, figClass } from './lib/format.js';
import AppBar from './components/AppBar.jsx';
import ConnectScreen from './components/ConnectScreen.jsx';
import PeriodScreen from './components/PeriodScreen.jsx';
import CountingScreen from './components/CountingScreen.jsx';
import Financials from './components/Financials.jsx';
import FileProfile from './components/FileProfile.jsx';
import { CountsSection, AttachmentsSection } from './components/Counts.jsx';
import Odometer from './components/Odometer.jsx';

function Totals({ summary }) {
  const c = summary.counts.totals;
  const mb = summary.attachments?.totalBytes ? (summary.attachments.totalBytes / 1048576).toFixed(1) : null;

  return (
    <div className="totals">
      <div className="total">
        <div className="total__k">List records</div>
        <Odometer value={c.listRecords} />
        <div className="total__s">{summary.counts.lists.length} record types · counted in full</div>
      </div>
      <div className="total t2">
        <div className="total__k">Transactions</div>
        <Odometer value={c.transactionRecords} />
        <div className="total__s">
          {summary.counts.transactions.length} types · {summary.periods.current.label.toLowerCase()}
        </div>
      </div>
      <div className="total t3">
        <div className="total__k">Attachments</div>
        <Odometer value={summary.attachments?.total ?? 0} />
        <div className="total__s">
          {mb ? `${mb} MB · ` : ''}
          {count(summary.attachments?.documents)} files
        </div>
      </div>
    </div>
  );
}

function Bar({ summary, status, busy, range, onChangePeriod, onRefresh, onDisconnect }) {
  const { company } = summary ?? {};

  return (
    <div className="bar bar--stacked">
      <div className="bar__top">
        <div className="who">{company?.name ?? 'Loading company…'}</div>
        <div className="bar__top-actions">
          <button className="ghost" type="button" onClick={onChangePeriod}>Change period</button>
          <button className="ghost" type="button" onClick={onDisconnect}>Change company</button>
        </div>
      </div>

      <div className="bar__actions">
        <a className="btn btn--quiet" href={api.exportUrl('excel', range)} download>Download Excel</a>
        <button className="btn" onClick={onRefresh} disabled={busy} type="button">
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState(null);
  const [stage, setStage] = useState(null);
  const [error, setError] = useState(null);
  const [booting, setBooting] = useState(true);
  const [screen, setScreen] = useState(null); // 'period' | 'counting' | 'results'
  const [range, setRange] = useState({ mode: 'twoYearYtd' });
  // Populated as soon as the 'counts' SSE event lands — well before the full
  // summary (financials + attachments) finishes — so CountingScreen's reveal
  // can start on real numbers instead of sitting at 0 for the whole build.
  const [earlyCounts, setEarlyCounts] = useState(null);
  const abortRef = useRef(null);
  // rebuild() reads this instead of closing over `range` directly so its own
  // identity stays stable — otherwise the boot effect below (which depends on
  // it) would re-run the whole status/cached-summary check every time the
  // user changes the date range, not just once on mount.
  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  // Surface anything the OAuth callback redirected back with.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) setError(params.get('error'));
    if (params.get('error') || params.get('connected')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const rebuild = useCallback(() => {
    setError(null);
    setEarlyCounts(null);
    setStage('company');
    abortRef.current?.();
    abortRef.current = api.streamSummary({
      ...rangeRef.current,
      onProgress: (p) => setStage(p.stage),
      onCounts: (c) => setEarlyCounts(c),
      onDone: (data) => {
        setSummary(data);
        setStage(null);
        // Screen transition to 'results' happens inside CountingScreen's
        // reveal sequence (onRevealDone), not here — see below.
      },
      onError: (e) => {
        setError(e.error ?? 'The summary could not be built.');
        setStage(null);
      },
    });
  }, []);

  const startCount = useCallback((next) => {
    if (next) {
      rangeRef.current = next;
      setRange(next);
    }
    setScreen('counting');
    rebuild();
  }, [rebuild]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const s = await api.status();
        if (cancelled) return;
        setStatus(s);
        if (!s.connected) return;

        // Show whatever's cached and skip straight to results; otherwise
        // send the user to pick a period first (never auto-build).
        try {
          const cached = await api.cachedSummary(rangeRef.current);
          if (cancelled) return;
          setSummary(cached);
          setScreen('results');
        } catch {
          if (!cancelled) setScreen('period');
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
      abortRef.current?.();
    };
  }, []);

  const disconnect = async () => {
    await api.disconnect(summary?.realmId ?? status?.realmId);
    setSummary(null);
    setScreen(null);
    setStatus({ ...status, connected: false, realmId: null, connections: [] });
  };

  const busy = Boolean(stage) || (screen === 'counting' && !error);

  let content;
  if (booting) {
    content = (
      <section className="screen screen--middle">
        <p style={{ color: 'var(--muted)', fontFamily: 'var(--mono)' }}>Checking connection…</p>
      </section>
    );
  } else if (!status?.connected) {
    content = <ConnectScreen environment={status?.environment} error={error} />;
  } else if (screen === 'period') {
    content = (
      <PeriodScreen
        summary={summary}
        status={status}
        range={range}
        busy={busy}
        onApply={startCount}
        onBack={disconnect}
      />
    );
  } else if (screen === 'counting') {
    content = (
      <CountingScreen
        stage={stage}
        counts={earlyCounts}
        summary={stage === null && !error ? summary : null}
        error={error}
        onRevealDone={() => setScreen('results')}
        onBack={() => setScreen('period')}
      />
    );
  } else {
    content = (
      <section className="screen">
        <div className="wrap">
          <AppBar />
          <Bar
            summary={summary}
            status={status}
            busy={busy}
            range={range}
            onChangePeriod={() => setScreen('period')}
            onRefresh={() => startCount()}
            onDisconnect={disconnect}
          />

          {error && <div className="banner" role="alert">{error}</div>}

          {summary && (
            <>
              <Totals summary={summary} />

              <FileProfile profile={summary.fileProfile} />
              <Financials financials={summary.financials} />
              <CountsSection counts={summary.counts} rangeLabel={summary.periods.current.label} />
              <AttachmentsSection attachments={summary.attachments} rangeLabel={summary.periods.current.label} />

              <p
                style={{
                  marginTop: 44,
                  paddingTop: 14,
                  borderTop: '1px solid var(--rule)',
                  fontSize: 12,
                  fontFamily: 'var(--mono)',
                  color: 'var(--muted)',
                }}
              >
                Fiscal year starts {summary.company.fiscalYearStartMonth} ·
                built in {(summary.durationMs / 1000).toFixed(1)}s ·
                <span className={figClass(null)}> {summary.counts.queriesIssued} count queries</span>
              </p>
            </>
          )}
        </div>
      </section>
    );
  }

  return content;
}

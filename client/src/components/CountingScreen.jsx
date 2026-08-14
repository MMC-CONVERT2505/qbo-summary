import { useEffect, useRef, useState } from 'react';
import Odometer from './Odometer.jsx';
import AppBar from './AppBar.jsx';

const STAGE_MESSAGES = {
  company: 'Reading the company profile…',
  counts: 'Counting lists and transactions…',
  financials: 'Pulling financial reports…',
  attachments: 'Scanning attachments…',
};
const STAGE_ORDER = ['company', 'counts', 'financials', 'attachments'];

const reduced = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Four phases:
 *
 * waiting   — real network round trip in flight, before counts exist yet.
 *             `stage` comes straight from the SSE onProgress callback.
 * counting  — `counts` has landed (right after the backend's "counts" stage,
 *             well before financials/attachments finish) — ticks through the
 *             real counts.lists/counts.transactions rows, dial accumulating
 *             to the true total. This is what makes the dial start moving
 *             long before the whole build is done.
 * counted   — the reveal animation itself finished, but the full `summary`
 *             (financials + attachments) hasn't arrived yet — dial holds its
 *             final real total rather than sitting idle or resetting.
 * done      — `summary` has now also arrived — flashes the done message,
 *             then hands off to Results.
 */
export default function CountingScreen({ stage, counts, summary, error, onRevealDone, onBack }) {
  const [dial, setDial] = useState(0);
  const [phase, setPhase] = useState('waiting');
  const [label, setLabel] = useState('Opening the company file…');
  const [pct, setPct] = useState(0);
  const revealStarted = useRef(false);
  const grandRef = useRef(0);
  const doneTimerRef = useRef(null);
  // Kept in a ref so the hand-off effect doesn't have to depend on a
  // callback whose identity changes every render.
  const revealDoneRef = useRef(onRevealDone);
  revealDoneRef.current = onRevealDone;

  useEffect(() => {
    if (!stage) return;
    if (!revealStarted.current) {
      setLabel(STAGE_MESSAGES[stage] ?? 'Working…');
      const i = STAGE_ORDER.indexOf(stage);
      if (i >= 0) setPct(((i + 1) / (STAGE_ORDER.length + 1)) * 100);
    } else if (phase === 'counted') {
      // Reveal already finished but the full summary hasn't landed —
      // financials + attachments can genuinely take 15-20s+, so keep
      // showing real backend progress instead of a static message that
      // reads as frozen once the dial stops moving.
      setLabel(STAGE_MESSAGES[stage] ?? 'Finishing up…');
    }
  }, [stage, phase]);

  useEffect(() => {
    if (!counts || revealStarted.current) return;
    revealStarted.current = true;

    const rows = [
      ...counts.lists.filter((r) => typeof r.total === 'number').map((r) => [r.label, r.total]),
      ...counts.transactions.filter((r) => typeof r.total === 'number').map((r) => [r.label, r.total]),
    ];
    const grand = rows.reduce((sum, [, n]) => sum + n, 0);
    grandRef.current = grand;

    if (reduced() || rows.length === 0) {
      setDial(grand);
      setPct(100);
      setPhase('counted');
      setLabel('Pulling reports and attachments…');
      return;
    }

    setPhase('counting');
    let running = 0;
    let i = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      if (i >= rows.length) {
        setPhase('counted');
        setLabel('Pulling reports and attachments…');
        return;
      }
      const [rowLabel, n] = rows[i];
      running += n;
      i += 1;
      setLabel(rowLabel);
      setPct((i / rows.length) * 100);
      setDial(running);
      setTimeout(tick, 90);
    };
    const t = setTimeout(tick, 380);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [counts]);

  // Only finish once the reveal has actually played out AND the full
  // summary is ready — whichever of the two finishes last.
  //
  // The hand-off timer lives in a ref, and cleanup happens on unmount only
  // (the effect below), NOT in this effect's own cleanup. Returning
  // `() => clearTimeout(t)` here would cancel the timer the instant
  // setPhase('done') re-rendered — the effect would tear down its own
  // pending hand-off before it could fire, and the `phase !== 'counted'`
  // guard would then stop it ever being rescheduled. Same for
  // `onRevealDone`: it's an inline arrow at the call site, so its identity
  // changes on every parent render; read it through a ref rather than
  // depending on it.
  useEffect(() => {
    if (phase !== 'counted' || !summary) return;
    setPhase('done');
    setLabel(`Done — ${grandRef.current.toLocaleString()} records counted`);
    doneTimerRef.current = setTimeout(() => revealDoneRef.current?.(), reduced() ? 0 : 500);
  }, [phase, summary]);

  useEffect(() => () => clearTimeout(doneTimerRef.current), []);

  if (error) {
    return (
      <section className="screen screen--middle">
        <div className="wrap">
          <AppBar />
          <div className="banner" role="alert">{error}</div>
          <button className="btn" style={{ marginTop: 20 }} type="button" onClick={onBack}>
            Back to period selection
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="screen screen--middle">
      <div className="wrap">
        <AppBar />
        <div className="eyebrow">Counting</div>
        <div className="dial"><Odometer value={dial} /></div>
        <div className={`ticker${phase === 'counted' ? ' ticker--pulse' : ''}`}>
          {phase === 'counting' ? <span>counting <b>{label}</b></span> : label}
        </div>
        <div className={`meter${phase === 'counted' ? ' meter--busy' : ''}`}><i style={{ width: `${pct}%` }} /></div>
      </div>
    </section>
  );
}

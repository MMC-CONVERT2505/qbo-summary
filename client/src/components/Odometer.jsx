import { useEffect, useRef } from 'react';

const reduced = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A mechanical tally-counter digit reel. Each digit of the formatted number
 * gets its own 0-9 reel; animating is a transform on that reel, not a
 * repaint of the text. Reserved for whole-number counts — money keeps its
 * plain tabular-mono rendering (parenthesized negatives), since a digit
 * roll doesn't suit signed currency.
 */
export default function Odometer({ value, delay = 0, className = '' }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || value === null || value === undefined) return;

    const text = Number(value).toLocaleString('en-US');
    el.innerHTML = '';
    const reels = [];

    for (const ch of text) {
      if (ch < '0' || ch > '9') {
        const s = document.createElement('span');
        s.className = 'sep';
        s.textContent = ch;
        el.appendChild(s);
        continue;
      }
      const win = document.createElement('span');
      win.className = 'win';
      const reel = document.createElement('span');
      reel.className = 'reel';
      for (let d = 0; d <= 9; d += 1) {
        const n = document.createElement('span');
        n.textContent = String(d);
        reel.appendChild(n);
      }
      win.appendChild(reel);
      el.appendChild(win);
      reels.push({ reel, target: Number(ch) });
    }

    reels.forEach((r, i) => {
      if (reduced()) {
        r.reel.style.transform = `translateY(-${r.target}em)`;
        return;
      }
      r.reel.style.transition = 'none';
      r.reel.style.transform = 'translateY(0)';
      void r.reel.offsetHeight; // commit the reset before rolling
      r.reel.style.transition =
        `transform ${760 + i * 90}ms cubic-bezier(.22,.61,.36,1) ${delay + i * 42}ms`;
      r.reel.style.transform = `translateY(-${r.target}em)`;
    });
  }, [value, delay]);

  return <span ref={ref} className={`odo ${className}`} aria-label={value == null ? '—' : String(value)} />;
}

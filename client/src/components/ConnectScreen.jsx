import { useState } from 'react';
import { api } from '../lib/api.js';
import Odometer from './Odometer.jsx';
import mmcLogo from '../assets/mmc-logo.png';
import qboLogo from '../assets/quickbooks-logo.png';

const PREVIEW_ROWS = [
  ['Customers', 212],
  ['Bills', 1043],
  ['Journal entries', 87],
  ['Attachments', 1377],
];

export default function ConnectScreen({ environment, error }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(error ?? null);

  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const { url } = await api.connectUrl();
      window.location.href = url;
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
  };

  return (
    <section className="screen screen--center">
      <div className="wrap">
        <div className="brand-lockup" aria-label="MMC Convert and QuickBooks Online">
          <img src={mmcLogo} alt="MMC Convert" className="brand-lockup__mmc" />
          <span className="brand-lockup__x">×</span>
          <img src={qboLogo} alt="QuickBooks Online" className="brand-lockup__qbo" />
        </div>
        <div className="tool-heading">QuickBooks Online · Summary Tool</div>
        <div className="hero">
          <div>
            <h1>
              Count <em className="accent">everything</em>
              <br />
              in the file.
            </h1>
            <p className="lede">
              Connect a company, choose a period, and get an exact count of every record and
              every attachment it holds. Nothing else.
            </p>
            <div className="cta">
              <button className="btn" onClick={connect} disabled={busy} type="button">
                {busy ? 'Opening QB Online…' : 'Connect QB Online'}
              </button>
              <span className="note">Read-only access · about 20 seconds</span>
            </div>
            {problem && <div className="banner" role="alert">{problem}</div>}
          </div>

          {/* Illustrative, not live — no company is connected yet at this point. */}
          <div className="preview" aria-hidden="true">
            {PREVIEW_ROWS.map(([label, n]) => (
              <div className="preview__r" key={label}>
                <span>{label}</span>
                <Odometer value={n} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

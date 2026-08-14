import { Section } from './primitives.jsx';
import { count } from '../lib/format.js';

const yesNo = (v) => (v === null || v === undefined ? '—' : v ? 'Yes' : 'No');
const num = (v) => (v === null || v === undefined ? '—' : count(v));

/**
 * The scoping checklist a reviewer fills in before diving into a file — COA
 * size, which optional features are turned on, fiscal year end. Point-in-
 * time facts about the file, not scoped to the selected period (unlike the
 * counts/financials sections below it).
 */
export default function FileProfile({ profile }) {
  if (!profile) return null;

  const rows = [
    ['Chart of accounts', num(profile.chartOfAccounts)],
    ['Bank / credit card accounts', `${num(profile.bankAccounts)} / ${num(profile.creditCardAccounts)}`],
    ['Multi-currency', yesNo(profile.multiCurrency)],
    ['Active employees', num(profile.activeEmployees)],
    ['Attachments', num(profile.attachments)],
    ['Classes / locations', `${num(profile.classes)} / ${num(profile.locations)}`],
    ['Tracked inventory', yesNo(profile.trackedInventory)],
    ['Projects', yesNo(profile.projects)],
    ['Estimates / quotes', num(profile.estimates)],
    ['Purchase orders', num(profile.purchaseOrders)],
    ['Fixed assets', yesNo(profile.fixedAssets)],
    ['Tax tracking (VAT / GST / sales tax)', yesNo(profile.taxTracking)],
    ['Fiscal year end', profile.fiscalYearEnd ?? '—'],
  ];

  return (
    <Section title="File profile" note="Scoping snapshot — not scoped to the selected period">
      <div className="profile-grid">
        {rows.map(([label, value]) => (
          <div className="profile-row" key={label}>
            <span className="profile-row__k">{label}</span>
            <span className="profile-row__v">{value}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

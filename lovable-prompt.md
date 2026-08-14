# Lovable prompt — QBO Summary

Copy everything in the box below into Lovable.

---

Build **QBO Summary** — a financial file-review dashboard for accountants and bookkeepers. It connects to a QuickBooks Online company and shows one page that answers: how big is this file, what shape are the books in, and where are the gaps. Think **Mercury / Ramp / Linear** aesthetic applied to an accounting workpaper — dense, numeric, monospaced figures, but alive: smooth motion, not a static spreadsheet.

## Visual direction

- Dark mode as the primary theme (light mode as a toggle), deep near-black background (`#0a0e0f` range), a single confident accent color (emerald/forest green — this is a ledger, lean into "green means money" without being literal or cheesy).
- Tabular/monospaced font (IBM Plex Mono, JetBrains Mono, or similar) for every number — labels and prose in a clean sans (Inter, Geist). Numbers must align in columns like a real ledger.
- Negative amounts in **parentheses**, not a minus sign — standard accounting convention, non-negotiable.
- Motion is the whole point of this brief:
  - Numbers **count up** from 0 (or from their previous value) when they change, eased, ~600-900ms.
  - Cards/rows **stagger in** on load (~40ms delay per row) rather than popping in all at once.
  - Charts animate their bars/lines drawing in, not appearing instantly.
  - Hovering a stat card lifts it slightly with a soft glow in the accent color.
  - Tab switches (e.g. Transactions ↔ Lists) crossfade + slide, don't hard-cut.
  - A skeleton/shimmer loading state for every section while data is "building" — not a spinner.
  - Subtle scroll-triggered reveal for sections below the fold.
- Respect information density — this is a professional tool for someone reviewing hundreds of transactions, not a marketing landing page. Motion should feel *precise*, like a well-built instrument panel, not bouncy or playful.

## Screens

### 1. Connect screen
Centered card: product name, one-line description ("Connect a QuickBooks Online company and get one page that says how big it is, what shape the books are in, and where the gaps are"), a short list of what it reports (counts, P&L, AR/AP aging, attachments), a primary "Connect to QuickBooks" button, small print: "Read-only access to accounting data." If an error is present, show it in a dismissible red-toned banner above the button.

### 2. Dashboard — masthead (sticky header)
- Company name (large), realm ID + environment (sandbox/production) + fiscal-year-start month as small metadata chips.
- A **date range picker**: a segmented control / dropdown with four modes — "This year (YTD)", "This + last year (YTD)", "Since inception", "Custom" (reveals two date inputs + Apply button when selected). Switching modes should visibly re-trigger the load animation for the whole page below.
- Right side: company switcher (if multiple connected), "Download PDF" / "Download Excel" buttons, a "Refresh" button (shows a spinner + disables while building), "Disconnect".
- Below the masthead during a build: a slim animated progress strip with 4 stages (Company profile → Lists and transactions → Reports → Attachments), each stage getting a checkmark as it completes, current stage pulsing.

### 3. Headline stat band
A row of 5 stat tiles, each with a label, a big monospace count-up number, and a small sub-line:
- Revenue (current range) — sub: % vs prior period (only if a comparison period exists)
- Net income — sub: % vs prior period
- Net cash — sub: "N accounts"
- Open AR — sub: "receivable"
- Open AP — sub: "payable"
- Transactions (count) — sub: the active date-range label

Color the revenue/net-income/cash figures green if positive, red (parenthesized) if negative.

### 4. Profit & loss
A comparison table: Line item (Revenue, COGS, Gross profit, Operating expenses, Other income/expenses, Net income) × columns for the current period and (when a comparison period exists) prior period, Change, and %. When there's no comparison period (YTD/Since-inception/Custom modes), just show the single current column — don't render an empty "prior" column.

### 5. Open receivables & payables
Two side-by-side animated bar charts (Receivables outstanding / Payables outstanding) with aging buckets (Current, 1-30, 31-60, 61-90, 91+) on the x-axis, dollar amount on the y-axis. The oldest bucket (91+) bar renders in red if it has a balance — that's the one that costs money. Big total dollar figure above each chart.

### 6. What's in the file (tabbed: Transactions / Lists)
- **Transactions tab**: table with Group tag, Transaction type, a count column labeled with the active date range, and a Share % column, grouped visually by "Money in" / "Money out" / "Ledger". Total row at the bottom.
- **Lists tab**: table with Group, Record type, Active, Inactive, Total columns (scoped to "created in [range]") — Customers, Vendors, Employees, Items, Chart of accounts, Classes, Departments, Terms, Payment methods, Tax codes, Currencies. Below it, a small secondary table: "AR / AP accounts in the chart of accounts" (same Active/Inactive/Total shape, just 2 rows).

### 7. Attachments
Small table: Record type, Records with attachments, Attachment links. Header note shows total count, size in MB, and how many are notes vs. files, scoped to the active date range.

## Data shape (design components against this exact structure)

```ts
type Summary = {
  realmId: string;
  generatedAt: string;       // ISO
  durationMs: number;
  environment: "sandbox" | "production";
  fromCache?: boolean;
  company: {
    name: string;
    legalName: string | null;
    country: string | null;
    fiscalYearStartMonth: string;
    email: string | null;
  };
  periods: {
    mode: "ytd" | "twoYearYtd" | "inception" | "custom";
    current: { label: string; start: string; end: string };
    priorYtd: { label: string; start: string; end: string } | null;
    asOf: string;
  };
  counts: {
    lists: Array<{ key: string; label: string; group: string; entity: string;
      status: "ok" | "unavailable" | "error"; note: string | null;
      active: number | null; inactive: number | null; total: number | null }>;
    chartBreakouts: Array<{ key: string; label: string; active: number; inactive: number; total: number }>;
    transactions: Array<{ key: string; label: string; group: string;
      status: string; note: string | null; total: number | null }>;
    totals: { listRecords: number; inactiveRecords: number; transactionRecords: number };
    queriesIssued: number;
  };
  financials: {
    profitAndLoss: {
      current: { period: { label: string }; revenue: number|null; costOfGoodsSold: number|null;
        grossProfit: number|null; operatingExpenses: number|null; otherIncome: number|null;
        otherExpenses: number|null; netIncome: number|null; totalExpenses: number|null } | null;
      priorYtd: (typeof profitAndLoss.current) | null;
    };
    receivables: { asOf: string; total: number|null; buckets: Array<{ label: string; amount: number|null }> } | null;
    payables: { asOf: string; total: number|null; buckets: Array<{ label: string; amount: number|null }> } | null;
    cash: { bankTotal: number; creditCardTotal: number; netCash: number;
      accounts: Array<{ id: string; name: string; type: string; balance: number; active: boolean }> } | null;
  };
  attachments: { totalAttachables: number; documents: number; notes: number; unlinked: number;
    totalBytes: number; truncated: boolean;
    perEntity: Array<{ type: string; files: number; links: number }> } | null;
  comparisons: { revenue: { current: number|null; prior: number|null; percent: number|null };
    netIncome: { current: number|null; prior: number|null; percent: number|null } } | null;
};
```

## Tech

React + TypeScript + Tailwind. Use Framer Motion for the animation work described above and Recharts (or a comparably capable chart library) for the aging bar charts. Build it screen-by-screen against mock data matching the exact shape above so it's a drop-in replacement for a real API later — don't invent extra fields.

---

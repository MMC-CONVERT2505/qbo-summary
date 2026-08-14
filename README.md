# QBO Summary

Connect a QuickBooks Online company and get one page that says how big the file is,
what shape the books are in, and where the gaps are — then export it as an Excel
workbook.

---

## Running it

**1. Create an Intuit app** at [developer.intuit.com](https://developer.intuit.com) →
*Dashboard* → *Create an app* → *QuickBooks Online and Payments*.

Copy the Client ID and Client Secret, and under *Redirect URIs* add exactly:

```
https://192.168.1.25.nip.io:4000/quickbooks-return
```

Intuit matches redirect URIs character for character. A trailing slash will fail.
Intuit's dashboard also rejects a bare `localhost` or `127.0.0.1` hostname —
it wants something that resolves over real DNS. `192.168.1.25.nip.io` is a free
wildcard-DNS name that always resolves to your own machine (`127.0.0.1`), so
it satisfies Intuit without any tunnel or public exposure.

**2. Configure and install**

```bash
cp .env.example server/.env    # then fill in QBO_CLIENT_ID and QBO_CLIENT_SECRET
npm install
```

**2b. Local HTTPS.** Intuit's redirect URI must be HTTPS. Generate a locally
trusted certificate with [mkcert](https://github.com/FiloSottile/mkcert) — no
tunnel, no public exposure, works entirely on localhost:

```bash
mkcert -install                                          # once per machine
mkdir -p server/certs
mkcert -key-file server/certs/localhost-key.pem \
       -cert-file server/certs/localhost.pem \
       localhost 127.0.0.1 ::1 192.168.1.25.nip.io
```

The server picks these up automatically (`server/src/config.js` →
`config.tls`) and serves HTTPS on port 4000. Without them it falls back to
plain HTTP with a warning, which Intuit's OAuth callback will reject.

**3. Run**

```bash
npm run dev     # API on :4000, dashboard on :5173
```

Open <http://192.168.1.25.nip.io:5173> — **not** `localhost:5173` — and choose
**Connect to QuickBooks**. The hostname has to match the OAuth redirect URI's
host, or the session cookie won't carry over and you'll get a "Sign-in state
did not match" error on the way back from Intuit. In sandbox mode
you'll be offered the sandbox company Intuit creates for every developer account.

**4. Verify without a connection** (parser, fiscal-year maths, both exporters):

```bash
cd server && node test/run.js
```

28 checks, no credentials needed. A sample XLSX lands in `server/test/out/`.

---

## What it reports

| Area | Detail |
|---|---|
| **Lists** | Customers, Vendors, Employees, Items, Chart of Accounts, Classes, Departments, Terms, Payment Methods, Tax Codes, Currencies — each counted active *and* inactive |
| **Transactions** | Invoices, Sales Receipts, Payments, Credit Memos, Refund Receipts, Estimates, Deposits, Bills, Bill Payments, Vendor Credits, Purchase Orders, Expenses, Checks, Card Charges, Journal Entries, Transfers, Time Activities — all time and current fiscal year |
| **Financials** | P&L (revenue, COGS, gross profit, expenses, net income) for YTD vs. the same span last year; balance sheet with a tie-out check; AR and AP aged into buckets; cash across bank and credit card accounts |
| **Attachments** | Count per entity type, plus notes vs. files and orphaned attachments |
| **Exports** | Multi-sheet Excel workbook |

---

## Architecture

```
server/src/
  config.js            env, endpoints, sandbox/prod switch, rate limits
  lib/limiter.js       concurrency + spacing, keeps us under Intuit's ceiling
  lib/store.js         file-backed token and summary store
  qbo/oauth.js         authorize, exchange, refresh (with a lock), revoke
  qbo/client.js        authenticated fetch, retry, Batch API, pagination
  qbo/catalog.js       every countable entity + how to build its count query
  qbo/counts.js        Phase 1 — all counts, batched
  qbo/periods.js       fiscal-year maths driven by the company's FY start month
  qbo/reports.js       Phase 2 — P&L, balance sheet, aging, cash
  qbo/attachments.js   attachment scan, grouped by entity type
  services/summary.js  orchestration, caching, variance, review flags
  services/excel.js    Phase 4 — Excel workbook
  services/scheduler.js Phase 4 — cron auto-refresh
  routes/              auth + summary/export HTTP layer

client/src/
  App.jsx              auth state, SSE progress, dashboard assembly
  components/          ledger tables, stat band, financial charts, counts
  lib/format.js        accounting conventions in one place
```

### Two decisions worth knowing about

**Counts go through the Batch API.** Roughly 60 `select count(*)` queries would be
60 round trips. The QBO Batch API takes 30 operations per call, so the whole of
Phase 1 collapses into two HTTP requests. A single failing item — `Class` on a file
with class tracking off — comes back as a fault on that item alone and is reported
as *"Not enabled on this company file"* rather than sinking the summary.

**Reports are parsed structurally, not positionally.** QBO report JSON is an
arbitrarily deep `Rows`/`Row` tree whose shape shifts between company files.
`flattenReport()` walks the whole tree into a flat list, then values are picked by
QBO's stable `group` attribute with a label match as fallback. This is why the
balance sheet parser finds `TotalAP` nested four levels down without knowing it
was going to be there.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/auth/connect` | Returns the Intuit authorize URL |
| `GET` | `/quickbooks-return` (path from `QBO_REDIRECT_URI`) | OAuth redirect target |
| `GET` | `/api/auth/status` | Connection state and connected companies |
| `POST` | `/api/auth/select` | Switch the active company |
| `POST` | `/api/auth/disconnect` | Revoke and forget |
| `GET` | `/api/summary` | Cached summary; `?force=true` rebuilds |
| `GET` | `/api/summary/stream` | Rebuild with SSE stage updates |
| `GET` | `/api/summary/cached` | Last build, never fetches |
| `GET` | `/api/summary/export/excel` | Excel workbook |
| `GET` | `/api/summary/schedule` | Auto-refresh status |
| `POST` | `/api/summary/schedule/run` | Run the refresh job now |

---

## Phase status

- **Phase 1 — OAuth + counts.** Done. Batched counts, per-item fault handling,
  active/inactive split, current-fiscal-year subtotals.
- **Phase 2 — Financial reports.** Done. P&L with prior-year comparison, balance
  sheet with tie-out check, AR/AP aging, cash position.
- **Phase 3 — Dashboard.** Done. Charts, ledger tables, live build progress,
  review flags.
- **Phase 4 — Export + auto-refresh.** Done. Excel, cron job with a manual
  trigger.

---

## Before you put this in front of a client

These are deliberate scaffolding shortcuts, not oversights:

1. **Token storage.** Refresh tokens sit in `server/.data/tokens.json` as plaintext.
   They are long-lived credentials to someone's accounting data. Move them into
   Postgres and encrypt them at rest before this touches a production company file.
2. **Sessions.** `express-session` uses its in-memory store, which loses sessions on
   restart and won't survive more than one server process. Swap in Redis.
3. **No user model.** Anyone who can reach the server can see any connected company.
   Add authentication and scope realms to users.
4. **Attachment scan pages the full `Attachable` list** because filtering by
   `AttachableRef.EntityRef.Type` is unreliable across company files. On a file with
   tens of thousands of attachments this is slow — move it to a nightly job.
5. **Multi-currency.** Figures are reported in the company's home currency as QBO
   returns them. Files with foreign-currency transactions need explicit handling.
6. **Refresh tokens expire after 100 days** of no use. A company nobody opens for
   three months will need reconnecting; the API returns `REAUTH_REQUIRED` for this.

## Notes on the QBO API

- Access tokens last one hour; refresh tokens last 100 days and rotate roughly
  every 24 hours. `oauth.js` refreshes 2 minutes ahead of expiry behind a lock so
  parallel requests can't invalidate each other's tokens.
- Rate limits are 500 requests/minute and 10 concurrent per realm. The limiter is
  set to 6 concurrent with a 130 ms floor between starts.
- QBO's query language has no `sum()`. Any total has to come from a report endpoint
  or from summing records client-side — which is why cash position reads
  `CurrentBalance` off the chart of accounts rather than querying transactions.
- `Purchase` covers expenses, checks and card charges; they're separated by
  `PaymentType`.
- Bump `QBO_MINOR_VERSION` deliberately. Newer minor versions add fields but
  occasionally change report column behaviour.

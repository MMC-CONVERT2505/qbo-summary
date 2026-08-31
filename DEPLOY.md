# Deploying QBO Summary

This runs on the same EC2 box as the other MMC Convert tools (QB-to-Xero,
QB-to-Xero-Attachment, etc.), behind the **nginx already installed on that
host**. It does not run its own reverse proxy — nginx there already owns
ports 80/443 and already handles TLS (via certbot) for every other project,
and this one config file just adds `qbo-summary.mmcconvert.com` to it.

The app is one Docker container (API + built React client, one process) on
an internal port that only nginx can reach.

Local development is unchanged — keep using `docker compose up` with the
existing `docker-compose.yml` and `node src/index.js`.

**Note on the command name:** every production command below uses
`docker-compose` (hyphenated) because that's what's installed on this box —
the older v1.29.2 standalone binary, not the newer `docker compose`
(space) plugin. Confirm with `docker-compose --version` if unsure. This is
different from a fresh box, which usually ships the v2 plugin instead —
don't be surprised if a future server needs the space form.

---

## Before you start

- **DNS already resolving**: `qbo-summary.mmcconvert.com` → this machine's
  public IP. Check with `dig +short qbo-summary.mmcconvert.com`. Wrong DNS at
  this point means certificate issuance fails later.
- In the **Intuit developer dashboard** (your app → Keys & OAuth → Redirect
  URIs), add exactly:
  ```
  https://qbo-summary.mmcconvert.com/quickbooks-return
  ```

---

## First deploy

```bash
cd ~
git clone <your-repo-url> qbo-summary
cd qbo-summary

cp .env.production.example .env.production
```

Edit `.env.production` and fill in:

| Variable | Value |
|---|---|
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` | from the Intuit dashboard |
| `SESSION_SECRET` | generate a fresh one: `openssl rand -hex 32` |
| `QBO_REDIRECT_URI` | `https://qbo-summary.mmcconvert.com/quickbooks-return` |
| `CLIENT_ORIGIN` | `https://qbo-summary.mmcconvert.com` |

### Start the container

```bash
docker-compose -f docker-compose.prod.yml up -d --build
```

Check it's actually up and reachable **on localhost only** — this is the
same port nginx will proxy to:

```bash
docker-compose -f docker-compose.prod.yml ps
curl -I http://127.0.0.1:4500/api/health
```

### Wire it into nginx

```bash
sudo cp deploy/nginx/qbo-summary.mmcconvert.com.conf \
  /etc/nginx/sites-available/qbo-summary.mmcconvert.com

sudo ln -s /etc/nginx/sites-available/qbo-summary.mmcconvert.com \
  /etc/nginx/sites-enabled/

# Always test before reloading — a bad config here can take down every
# other site nginx serves on this box, not just this one.
sudo nginx -t

# reload, not restart — reload is graceful and doesn't drop the other
# projects' existing connections
sudo systemctl reload nginx
```

At this point `qbo-summary.mmcconvert.com` is live over plain HTTP. Now get
the certificate — certbot detects the existing block and rewrites it in
place to add HTTPS, exactly like it already did for the other subdomains:

```bash
sudo certbot --nginx -d qbo-summary.mmcconvert.com
```

Confirm:

```bash
sudo certbot certificates | grep -A5 qbo-summary
curl -I https://qbo-summary.mmcconvert.com/api/health
```

Then open <https://qbo-summary.mmcconvert.com> and run through Connect →
pick a period → count → Results, for real.

---

## Everyday commands

```bash
# Deploy the latest code — pulls, builds, restarts, health-checks
cd ~/qbo-summary
./deploy.sh

# Stop / start (no rebuild)
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d

# Logs
docker-compose -f docker-compose.prod.yml logs -f

# What's running (this project only — distinct name, won't show the others)
docker-compose -f docker-compose.prod.yml ps
```

Note there's **no nginx step** in a normal redeploy — the site config only
needs touching once, at first setup, or if you ever change the internal
port.

### Why `deploy.sh` instead of `up -d --build`

This box runs docker-compose v1.29.2, which crashes with
`KeyError: 'ContainerConfig'` whenever it tries to **recreate** an existing
container against a newer-format image — it happens on every redeploy, not
occasionally. The build itself always succeeds; only the recreate step dies.
`deploy.sh` removes the old container before starting the new one, which
avoids that broken code path entirely.

If you ever run the raw command by hand and hit that error, the image is
already built — just finish it with:

```bash
docker-compose -f docker-compose.prod.yml rm -f -s app
docker-compose -f docker-compose.prod.yml up -d
```

Neither touches the `app_data` volume, so nothing is lost.

### What survives what

`down`, rebuilds, and `git pull` are all safe: QuickBooks connections, cached
summaries, and user sessions all live in the `app_data` **volume**, not the
container. A deploy doesn't force anyone to reconnect QuickBooks or log back in.

Only `docker-compose -f docker-compose.prod.yml down -v` destroys that — the
`-v` deletes the volume. Don't use it unless you mean to wipe every connection.

---

## This tool vs. the other projects on this box

- **Isolated ports.** `4500` was checked against every port already bound
  by `QB-to-Xero`/`QB-to-Xero-Attachment` before picking it — no overlap.
  Bound to `127.0.0.1` only, so (unlike some of the other containers) it
  isn't reachable directly from the internet, only through nginx.
- **Isolated Docker resources.** The compose file sets an explicit project
  name (`qbo-summary`), so its container, volume, and network are all
  prefixed `qbo-summary-*` / `qbo-summary_*` — `docker ps` / `docker volume
  ls` stay unambiguous next to the other projects' containers.
- **One new nginx file, nothing edited.** The other three site files in
  `/etc/nginx/sites-enabled/` aren't touched. `nginx -t` before every reload
  is the safety check that catches a mistake before it reaches production.
- **Separate certificate.** `certbot --nginx -d qbo-summary.mmcconvert.com`
  issues its own certificate, independent of the other three already on this
  box (confirmed via `certbot certificates` before writing this).

---

## Turning on the password gate

Nothing in the app asks for a login, so anyone with the URL can connect or
disconnect QuickBooks companies. To require a shared password, add HTTP
basic auth at the nginx layer — this needs `apache2-utils` (for `htpasswd`;
harmless to install even though the tool is nginx, it just provides the hash
generator):

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd-qbo-summary mmc
# enter a password when prompted
```

Then add these two lines inside the `location /` block of
`/etc/nginx/sites-available/qbo-summary.mmcconvert.com`:

```
auth_basic "QBO Summary";
auth_basic_user_file /etc/nginx/.htpasswd-qbo-summary;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Troubleshooting

**`certbot --nginx` fails.** Almost always DNS. Re-check
`dig +short qbo-summary.mmcconvert.com` points at this box, and that
port 80 is reachable from the internet (security group).

**App container won't start.** `docker-compose -f docker-compose.prod.yml
logs app`. If it says `SESSION_SECRET must be set when NODE_ENV=production`,
that variable is empty in `.env.production` — a deliberate guard against
running with a publicly-known default signing key.

**502 from nginx.** The app container isn't up, or isn't listening on 4500.
Check `docker-compose -f docker-compose.prod.yml ps` and
`curl http://127.0.0.1:4500/api/health` directly.

**"Sign-in state did not match" during Connect.** The redirect URI in
`.env.production` and the one registered at Intuit differ, or the container
restarted mid-handshake. Compare both strings exactly, then retry.

**Counting screen freezes partway.** A full build genuinely takes 20-30
seconds (three QuickBooks report calls). If the ticker text stops changing
entirely, that's a real stall — check `logs app`. If it hangs specifically
right after the dial finishes moving, re-check the `proxy_buffering off`
block in the nginx config for `/api/summary/stream` — without it the stream
gets held by nginx until the whole build finishes.

---

## Known gaps

Worth knowing before this holds many clients' books:

- **Refresh tokens are stored in plaintext** in the data volume. They're
  100-day credentials to live QuickBooks files. Anyone with volume or backup
  access has them. Encrypting at rest, or moving to a secrets manager, is the
  real fix.
- **No per-user accounts.** The password gate above is one shared credential —
  it stops strangers, but doesn't distinguish your team members from
  each other.
- **Single container only.** Sessions and the data store are file-backed with
  in-process locking. Running multiple replicas behind a load balancer would
  need Redis (sessions) and a real database (tokens/summaries) first.
- **3 moderate npm advisories** (`uuid` via `exceljs` and `node-cron`).
  Clearing them needs a breaking `node-cron` major upgrade.

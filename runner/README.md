# Live test runner

A small, dependency-free Node service (`server.mjs`) that lets the portfolio
"Live QA Lab" trigger a curated subset of this Playwright suite against the
deployed test environment and stream results back over Server-Sent Events.

## Why it's safe to expose

- **Allowlist only.** Visitors send a `group` id; the actual Playwright args
  live in [`groups.mjs`](groups.mjs). No request input ever reaches the command
  line — there is no injection surface. The CLI is invoked directly via
  `node …/@playwright/test/cli.js` (no shell, no `npx`).
- **Single-flight.** One run at a time. Concurrent requests get `409` with the
  active run id and the UI attaches to that run's stream instead.
- **Rate limited.** Per-IP and global sliding 1-hour windows.
- **Hard timeout.** The child is killed if it overruns `RUNNER_TIMEOUT_MS`.
- **CORS locked** to the origins in `ALLOWED_ORIGINS`; `POST /api/run` also
  rejects disallowed origins outright.
- **Secrets stay server-side.** The disposable test account and any admin key
  come from the runner's environment, never from the request.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness + current active run id |
| GET | `/api/groups` | Allowlisted groups (for the UI) |
| GET | `/api/latest` | Most recent finished run summary |
| GET | `/api/run/:id` | Snapshot of a run |
| GET | `/api/run/:id/stream` | SSE: `status`, `log`, `test`, `done` events (buffered + replayed) |
| POST | `/api/run` | Start a run — body `{ "group": "unauth" }` → `202 { runId }` |
| GET | `/reports/:id/*` | Static Playwright HTML report for a run |

## Configuration (env)

Reuses the suite's `TEST_BASE_URL`, `TEST_EMAIL`, `TEST_PASSWORD`, `ADMIN_API_KEY`
(see the repo's [`.env.example`](../.env.example)), plus:

| Var | Default | Meaning |
| --- | --- | --- |
| `RUNNER_PORT` | `8787` | Port to listen on |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated browser origins (your portfolio) |
| `RUNNER_RATE_PER_HOUR` | `6` | Max runs per IP per rolling hour |
| `RUNNER_GLOBAL_PER_HOUR` | `40` | Max runs total per rolling hour |
| `RUNNER_TIMEOUT_MS` | `180000` | Kill a run after this long |
| `RUNNER_MAX_REPORTS` | `20` | HTML reports to keep on disk |

## Running

```bash
npm ci
npm run pw:install        # Chromium must be installed on the host
npm run serve             # or: node runner/server.mjs
```

## Deploying on the VPS

The runner runs on the same host as `test.memdecks.com`. Run it as a service and
put it behind your reverse proxy on its own subdomain (e.g. `qa.memdecks.com`),
then set the portfolio's `VITE_RUNNER_URL` to that origin and add the portfolio
domain to `ALLOWED_ORIGINS`.

Example systemd unit (`/etc/systemd/system/translator-qa-runner.service`):

```ini
[Unit]
Description=translator-qa live test runner
After=network.target

[Service]
WorkingDirectory=/srv/translator-qa
EnvironmentFile=/srv/translator-qa/.env
ExecStart=/usr/bin/node runner/server.mjs
Restart=on-failure
User=qa

[Install]
WantedBy=multi-user.target
```

Nginx (SSE needs buffering off):

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # used for rate limiting
    proxy_buffering off;                              # required for SSE
    proxy_read_timeout 300s;
}
```

> Reverse-proxy TLS terminates at nginx; the runner itself speaks plain HTTP on
> localhost. Because rate limiting keys on `X-Forwarded-For`, make sure only your
> proxy can reach the port directly (bind to `127.0.0.1` or firewall it).

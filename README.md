# WhatsApp Group Monitor

Self-hosted WhatsApp group activity monitor. Tracks group members, messages, reactions, polls, and events via a web dashboard.

## WhatsApp Account

This tool uses [Baileys](https://github.com/WhiskeySockets/Baileys), an open-source library that connects to WhatsApp as a linked device. No WhatsApp Business account or API subscription is needed — a regular WhatsApp account works.

You can use your own WhatsApp account or a dedicated one. The monitor connects as a linked device and passively tracks group activity without interfering with normal use.

If the service restarts, it automatically catches up on messages it missed while offline. However, if you disconnect (unlink the device) and re-connect, messages sent while disconnected will not be recovered.

## Deployment

### Railway

1. Deploy from GitHub repo
2. Add a **Volume** mounted at `/app/data`
3. Set environment variables: `ADMIN_PASSWORD` (required), optionally `ADMIN_USERNAME`
4. Railway auto-detects the Dockerfile and builds on every push to main

### Docker

```bash
cp .env.example .env
# Edit .env: set ADMIN_PASSWORD
docker compose up --build
```

Data is persisted in a named Docker volume.

### Local

Requires Node.js 22+ and npm.

```bash
npm install
cp .env.example .env
# Edit .env: set ADMIN_PASSWORD
npm run dev
```

## Getting Started

1. Open the web panel and log in
2. Scan the QR code with WhatsApp (Linked Devices > Link a Device)
3. The dashboard shows all groups the account is in, with member counts and activity stats

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_PASSWORD` | *(required)* | Password for the web panel |
| `ADMIN_USERNAME` | `admin` | Username for the web panel |
| `PORT` | `3000` | Web server port |
| `DATA_DIR` | `./data` | Directory for auth state and database |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

Additional settings (project name, page size) are configurable from the Settings page.

## Data Isolation

Each WhatsApp account gets its own database at `data/{phone}/account.db`. Disconnecting and connecting a different number creates a separate database — no data mixing between accounts. Shared settings are stored in `data/monitor.db`.

## Tech Stack

Baileys (WhatsApp Web) + Fastify + SQLite (better-sqlite3) + Drizzle ORM + TypeScript

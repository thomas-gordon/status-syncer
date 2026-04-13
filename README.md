# Status Watcher

Automatically sync your Slack status with your Google Calendar events. Uses the full event title — not "Busy".

## Features

- **Google Calendar integration** — reads current events via OAuth
- **Slack integration** — updates your status with event title + emoji
- **Event type detection** — different emoji for Regular, Focus Time, and Out of Office events
- **Working hours** — only syncs during configured hours/days
- **Respect manual status** — skips sync if you've manually changed your Slack status
- **Clear on end** — automatically clears status when an event finishes
- **Mute notifications** — optionally enable Slack DND during events
- **Background sync** — polls every 60 seconds

## Setup

### Prerequisites

- Docker & Docker Compose
- A [Google Cloud](https://console.cloud.google.com) project with Calendar API enabled + OAuth credentials
- A [Slack App](https://api.slack.com/apps) with user scopes: `users.profile:read`, `users.profile:write`, `dnd:write`

### 1. Configure environment

```bash
cp .env.example .env
```

Fill in your `.env`:

| Variable | Description |
|---|---|
| `NEXTAUTH_SECRET` | Random string (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Your app URL (e.g. `https://status-watcher.yourdomain.com`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `SLACK_CLIENT_ID` | Slack app client ID |
| `SLACK_CLIENT_SECRET` | Slack app client secret |

### 2. Set OAuth redirect URIs

- **Google:** `{NEXTAUTH_URL}/api/integrations/google/callback`
- **Slack:** `{NEXTAUTH_URL}/api/integrations/slack/callback`

### 3. Run

```bash
docker compose up --build
```

The app will be available at `http://localhost:4100`.

## Management

A helper script is included for start/stop/status:

```bash
./status-watcher.sh start    # start tunnel + docker
./status-watcher.sh stop     # stop everything
./status-watcher.sh restart
./status-watcher.sh status
./status-watcher.sh logs
```

## Tech Stack

- Next.js 14 (App Router)
- Prisma + PostgreSQL
- NextAuth.js (credentials auth)
- Tailwind CSS
- Docker

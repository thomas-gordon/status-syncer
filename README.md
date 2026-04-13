# Status Watcher

Automatically sync your Slack status with your Google Calendar events. Uses the full event title — not "Busy".

## Features

- **Google Calendar integration** — reads current events via OAuth
- **Slack integration** — updates your status with event title + emoji
- **Event type detection** — different emoji for Regular, Focus Time, and Out of Office events
- **Private event handling** — either mask private events as "Busy" or ignore them entirely
- **Working hours** — only syncs during configured hours/days
- **Respect manual status** — skips sync if you've manually changed your Slack status
- **Clear on end** — automatically clears status when an event finishes
- **Mute notifications** — optionally enable Slack DND during events
- **Background sync** — polls every 60 seconds

## Architecture compatibility

Builds and runs cleanly on both **arm64** (Apple Silicon Mac) and **x86_64** (Intel Mac, Synology NAS, most Linux servers).

This works because:

- `prisma/schema.prisma` includes binary targets for both architectures, so `prisma generate` downloads both engines at build time
- All base images (`node:20-alpine`, `postgres:16-alpine`, `cloudflare/cloudflared`) are multi-arch
- `docker compose up --build` uses the host's native architecture

**Caveat:** do not copy a built image between architectures. Run `docker compose up --build` on the target host. If you need a single image for both archs, see the buildx appendix below.

## Setup

### Prerequisites

- Docker & Docker Compose
- A [Google Cloud](https://console.cloud.google.com) project with Calendar API enabled + OAuth credentials
- A [Slack App](https://api.slack.com/apps) with user scopes: `users.profile:read`, `users.profile:write`, `dnd:write`
- (Optional) A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) for public HTTPS access

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
| `CLOUDFLARE_TUNNEL_TOKEN` | (Optional) Cloudflare tunnel token for public access |

### 2. Set OAuth redirect URIs

- **Google:** `{NEXTAUTH_URL}/api/integrations/google/callback`
- **Slack:** `{NEXTAUTH_URL}/api/integrations/slack/callback` (Slack requires HTTPS)

### 3. Run

```bash
docker compose up --build -d
```

The app will be available at `http://localhost:4100` (or your tunnel URL).

The compose stack includes:
- **app** — the Next.js application (port 4100)
- **db** — PostgreSQL 16
- **tunnel** — Cloudflare tunnel (point its public hostname to `http://app:4100`)

## Deployment

### macOS (Apple Silicon or Intel)

```bash
cd /path/to/status-watcher
docker compose up --build -d
```

A helper script manages launchd agents for tunnel + docker auto-start:

```bash
./status-watcher.sh start
./status-watcher.sh stop
./status-watcher.sh restart
./status-watcher.sh status
./status-watcher.sh logs
```

### Synology NAS (x86_64)

1. Install **Container Manager** from Package Center
2. Copy the project to `/volume1/docker/status-watcher/`
3. Ensure `.env` sits in the same directory as `docker-compose.yml`
4. **Build on the NAS itself**, not on your Mac — architecture must match the host running the image:
   ```bash
   cd /volume1/docker/status-watcher
   docker compose up --build -d
   ```
5. Exclude `/volume1/docker/` from Synology Media Indexing (Control Panel → Indexing Service) to prevent `@eaDir` folders appearing inside the project and breaking the Next.js build

### Generic x86_64 Linux host

Same as the Synology instructions — just `cd` into the project directory and `docker compose up --build -d`.

## Appendix: multi-arch builds with buildx

If you want a single image runnable on both architectures (e.g. to push to a private registry and pull onto multiple hosts):

```bash
docker buildx create --use
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t your-registry/status-watcher:latest \
  --push .
```

This requires pushing to a registry; it's not needed for the standard single-host workflow above.

## Database migrations

Schema changes are tracked as Prisma migrations in `prisma/migrations/` and applied automatically on container start via `prisma migrate deploy`.

### Creating a new migration

When you change `prisma/schema.prisma`:

```bash
# With your local stack running (DB accessible)
npx prisma migrate dev --name describe_your_change
```

This generates a SQL migration file in `prisma/migrations/`, applies it locally, and regenerates the Prisma client. Commit the new migration directory to git.

On next deploy, `prisma migrate deploy` will apply any pending migrations during container startup.

### Baselining an existing database

If you have a database that pre-dates migration tracking (e.g. previously managed by `prisma db push`), mark the initial migration as already applied so `migrate deploy` doesn't try to recreate everything:

```bash
docker compose exec app npx prisma migrate resolve --applied <migration_name>
```

## Tech Stack

- Next.js 14 (App Router)
- Prisma 5 + PostgreSQL
- NextAuth.js (credentials auth)
- Tailwind CSS
- Docker + Cloudflare Tunnel

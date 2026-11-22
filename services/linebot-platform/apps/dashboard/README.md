# LINE Bot Control Dashboard

Local-first React/Vite dashboard for controlling isolated LINE bot processes.

## Run locally

From the repository root:

```bash
pnpm install
pnpm --filter @linebot/dashboard dev
```

The dashboard opens on `http://localhost:5173`. Copy `.env.example` to `.env.local`
when a different API origin is required.

## Environment variables

- `VITE_API_BASE_URL`: absolute backend origin, or empty for same-origin requests.
- `VITE_API_PROXY_TARGET`: Vite-only `/v1` proxy target.

The dashboard always talks to the live Control API; there is no local demo/mock
data fallback.

The primary read endpoint is `GET /v1/dashboard/overview`. Mutations use the
bot-scoped `/v1` endpoints and expect the envelope
`{ data, meta?, error?, requestId }`. Live status refreshes through
`GET /v1/events` using Server-Sent Events.

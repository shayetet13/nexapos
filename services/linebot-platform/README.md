# LINEJS platform (PromptPay auto-verify)

Bundled copy of `linebot-control-platform`: the service NexaPos calls to confirm that a
PromptPay transfer really arrived. A LINE account ("bot") joins the bank's LINE OA chat,
reads the transfer notification, and matches it to the QR payment NexaPos created.

| Part | Path | Port | Role |
|------|------|------|------|
| API (Hono + SQLite) | `apps/api` | `8787` (loopback) | `/v1/bots`, `/v1/promptpay/payments`, API keys |
| Bot worker / supervisor | `apps/bot-worker`, `apps/supervisor` | – | One process per bot, talks to LINE via `@evex/linejs` |
| Dashboard (Vite + React) | `apps/dashboard` | `5173` (loopback) | Log a bot in (QR), allow chats, create `lbk_` API keys |
| Contracts / rule engine | `packages/*` | – | Shared zod schemas, auto-reply rules |

## How it plugs into NexaPos

```
POS checkout ──► NexaPos backend (:4000)          ──► LINEJS API (:8787) ──► bot ──► LINE OA (bank)
                 /shops/:shopId/promptpay-verify/*     /v1/promptpay/payments
                 (shop_id-scoped)                      (ONE server-side key: env LINEJS_API_KEY)
```

- **One platform key, held by the NexaPos backend only** (`LINEJS_API_KEY`, `lbk_…`, scopes
  `bots:read`, `promptpay:read`, `promptpay:write`). It is never shown to or stored per shop.
- **Dev binds bots to shops** (Dev Dashboard → Settings → "ผูก LINE Bot ให้แต่ละร้าน"): one bot per shop.
  Shop owners only set their PromptPay number and switch the feature on/off.
- Per-shop config lives in `shop_promptpay_verify`, payments in `promptpay_payments` — always filtered
  by `shop_id`. A shop can only read or cancel payments it created itself.
- NexaPos does not trust the platform's responses: it checks the bot, the amount and that the QR pays the
  shop's own PromptPay account (EMV tag 29 + CRC) before showing it to a customer.
- Platform URL: backend env `LINEJS_API_BASE_URL` (pins the destination of the key and wins over the DB);
  without it, the value saved in Dev Dashboard → Settings is used; with neither, auto-verify is off and the
  POS keeps its manual flow. There is no implicit localhost default.
- Admin → Settings → "ประวัติและสถิติ PromptPay" shows history / totals / bank split from
  `GET /api/v1/shops/:shopId/promptpay-verify/{payments,stats}`. Payments left pending after a cashier
  closes the screen are reconciled with the platform when the history is opened.

## Run

```powershell
pnpm install
pnpm dev:linebot       # API :8787 + dashboard :5173
pnpm dev:all           # NexaPos frontend + backend + LINEJS API
pnpm test:linebot      # platform unit tests
pnpm typecheck:linebot
```

`start.bat` at the repo root starts the platform together with NexaPos.

First run: open <http://localhost:5173>, create a bot, log in the LINE account by scanning the QR,
allow the bank's LINE OA chat under *Targets* (confirm consent), then create **one** API key with scopes
`bots:read`, `promptpay:read`, `promptpay:write`. Put it in `apps/backend/.env` as `LINEJS_API_KEY`
(plus `LINEJS_API_BASE_URL=http://127.0.0.1:8787`), restart the backend, then bind the bot to each shop in the
NexaPos Dev Dashboard.

## Configuration

Copy `.env.example` to `apps/api/.env.local` (git-ignored). Runtime state — the SQLite file and the
encrypted LINE session files under `apps/api/data/` — decrypts to live LINE tokens and is git-ignored;
never commit it.

## Security notes

- The API binds to `127.0.0.1` by default. Containers set `API_HOST=0.0.0.0` explicitly.
- With `REQUIRE_AUTH=false` (default) every `/v1` route that is not called with an API key is
  **unauthenticated**. The API therefore refuses to start when it is exposed (`API_HOST` not loopback, or
  `NODE_ENV=production`) unless `REQUIRE_AUTH=true` and real `ADMIN_PASSWORD`, `JWT_SECRET`
  (≥ 32 chars) and `ENCRYPTION_KEY` are set (`src/boot-guard.ts`). On loopback the built-in defaults still work.
- API keys are **fleet-wide**: a key sees every bot and payment on this platform, not just one shop's.
  That is why the key is a server-side secret of the NexaPos backend and shop owners never receive one.
  Never hand a `lbk_` key to a shop or any other tenant. Revoke any per-shop keys issued before migration 0030.
- Use a dedicated key with only the three scopes above.
- `vite preview` binds every interface and does **not** proxy `/v1` unless `VITE_API_PROXY_TARGET` is set explicitly.
- Self-botting a personal LINE account may breach LINE's terms; use a dedicated account for the shop.

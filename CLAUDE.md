# NexaPos — Project Rules

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TailwindCSS |
| Backend | Fastify 5, TypeScript, Drizzle ORM |
| Database | PostgreSQL via Supabase |
| Auth | Supabase Auth + Custom JWT |
| Validation | Zod schemas everywhere |
| Monorepo | pnpm workspaces |

## Multi-Tenant Architecture (CRITICAL)

This is a **single-host, multi-store SaaS POS**. Every piece of data and logic MUST be isolated per store (`shop_id` / `tenant_id`).

### Isolation Rules
- **ALL** database queries MUST include `shop_id` filter — no exceptions
- **ALL** API routes MUST verify `shop_id` from JWT claim, never trust client payload
- Row Level Security (RLS) on every Supabase table — `shop_id = auth.jwt()->>'shop_id'`
- Payment credentials, PromptPay QR, slip upload configs — stored per shop, encrypted AES-256
- Orders, products, categories, staff, reports — all scoped to `shop_id`
- One shop CANNOT read/write another shop's data under any circumstance

### Payment Isolation
- Each shop has its own payment config (PromptPay number, bank account, Stripe account)
- Payment events/webhooks MUST validate `shop_id` from metadata before processing
- Transaction history is shop-scoped; cross-shop queries are forbidden
- QR codes are generated per shop using that shop's registered account number

## 13 Security Standards (NON-NEGOTIABLE)

### 1. Authentication — Supabase Auth + Custom JWT
- All protected routes require valid JWT in `Authorization: Bearer <token>`
- JWT must contain `shop_id`, `user_id`, `role` claims
- Token expiry: access 15m, refresh 7d; auto-rotate refresh tokens

### 2. Authorization — Row Level Security (RLS)
- Every table has RLS enabled via `shop_id` claim
- Staff roles: `owner`, `manager`, `cashier` — enforce in middleware + RLS
- Never bypass RLS with service-role key in user-facing code

### 3. API Security — API Key + JWT validation
- Internal service calls use `X-Internal-Token` header (CF Worker Secret)
- Public webhooks (payment callbacks) validate HMAC signature
- Rate limit: 100 req/min per IP, 1000 req/min per shop

### 4. Data Encryption — AES-256
- Payment credentials encrypted before DB insert via `lib/crypto.ts`
- Encryption key from environment variable (never hardcoded)
- Sensitive fields: `promptpay_number`, `bank_account`, `api_keys`

### 5. Transport — TLS 1.3
- All traffic HTTPS only; HTTP redirects to HTTPS
- HSTS: `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- No mixed content allowed

### 6. Input Validation — Zod
- ALL request bodies validated with Zod schema before processing
- Sanitize HTML in any user-generated text fields
- File uploads: whitelist MIME types, max size 5MB

### 7. SQL Injection — Parameterized queries (Drizzle)
- NEVER use string concatenation in SQL
- Use Drizzle ORM query builder exclusively
- Raw SQL only when absolutely necessary, always with `$1, $2` placeholders

### 8. XSS — React auto-escaping + CSP headers
- Never use `dangerouslySetInnerHTML`; if required, sanitize with DOMPurify first
- CSP header: `default-src 'self'; script-src 'self'; object-src 'none'`
- All user content rendered via React (auto-escaped)

### 9. CSRF — SameSite cookies + token validation
- Session cookies: `SameSite=Strict; HttpOnly; Secure`
- State-changing API calls include `X-CSRF-Token` header
- Validate token server-side against session

### 10. Rate Limiting — Fastify rate-limit plugin
- `@fastify/rate-limit` already installed — use it on all public routes
- Payment endpoints: 10 req/min per shop
- Auth endpoints: 5 req/min per IP

### 11. CORS — Strict origin
- Allow only: `process.env.FRONTEND_URL` in development, production domain in prod
- No wildcard `*` origins on authenticated routes
- Pre-flight OPTIONS handled automatically

### 12. Secrets — Environment variables only
- ZERO hardcoded secrets, API keys, or connection strings in source code
- Use `env.ts` (Zod-validated) to load all environment variables
- `.env` files in `.gitignore`; use `.env.example` with placeholder values

### 13. Audit Logging — All sensitive actions
- Log to `audit_logs` table: `shop_id`, `user_id`, `action`, `resource`, `ip`, `timestamp`
- Sensitive actions: login, logout, payment, refund, product CRUD, role changes, config changes
- Logs are append-only; no UPDATE/DELETE on audit_logs table

### 14. Session Security
- Cookies: `HttpOnly; Secure; SameSite=Strict`
- Session invalidation on logout (revoke refresh token)
- Concurrent session limit: 3 active sessions per user

## Token Usage Optimization Rules

### Silent Operation Mode
- Execute file reads, searches, and analysis **silently** without narrating each step
- Output a single `⚙ …` status line while working; replace with result when done
- Do NOT print intermediate "reading file X", "searching for Y" messages
- Show a progress indicator (e.g., `[ 1/4 ] analyzing schema...`) for multi-step tasks

### Minimal Context Loading
- Read ONLY the files directly relevant to the task
- Never read entire directories; use Grep/Glob to find specific files first
- Prefer `Grep` over `Read` for locating specific logic
- Cache findings mentally; do not re-read the same file twice in one session

### Focused Output
- No redundant confirmation messages ("I've completed X, now I'll do Y")
- No re-stating what was asked before answering
- Code blocks only for actual code; use prose for explanations
- Summarize file structures as tables, not lists of reads

### Post-Process Recheck
After **every** implementation task, silently verify:
1. ✅ `shop_id` isolation present in all new/modified queries
2. ✅ Zod validation on all new API inputs
3. ✅ No hardcoded secrets or connection strings
4. ✅ RLS not bypassed
5. ✅ Audit log entry added for any sensitive action
6. ✅ TypeScript compiles with no `any` escape hatches on new code
7. ✅ New routes have rate limiting applied

Report recheck as a compact table, only showing FAIL rows if all pass just write `✅ Recheck passed`.

## Code Style

- TypeScript strict mode; no `any` unless unavoidable with comment
- Drizzle ORM for all DB access; no raw pg queries without parameterization
- Fastify route handlers: `async (req, reply)` pattern; use `reply.send()`
- Next.js App Router; server components by default; client components only when needed
- TailwindCSS utility classes; no inline styles; no CSS-in-JS

## Project Structure

```
apps/
  frontend/          # Next.js 15 app
    src/
      app/           # App Router pages
      components/    # Shared UI components
      lib/           # Client utilities
  backend/           # Fastify API
    src/
      routes/        # API route handlers
      services/      # Business logic
      repositories/  # DB access layer (Drizzle)
      middleware/    # Auth, rate-limit, validation
      lib/           # Shared utilities (crypto, audit, etc.)
      db/            # Drizzle schema + migrations
packages/
  shared/            # Types shared between frontend/backend
```

## Development Commands

```bash
pnpm dev              # Start both frontend and backend
pnpm dev:frontend     # Frontend only (port 3000)
pnpm dev:backend      # Backend only (port 3001)
pnpm db:push          # Push schema to DB (dev)
pnpm db:migrate       # Run migrations (prod)
pnpm db:generate      # Generate migration files
```

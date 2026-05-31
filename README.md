# NexaPos

Multi-tenant POS SaaS — Solo Builder + AI Assisted Master Blueprint.

## Tech Stack

- **Frontend**: Next.js (App Router), TypeScript, TailwindCSS, PWA
- **Backend**: Fastify, Drizzle ORM, PostgreSQL (Supabase)
- **Auth**: Supabase Auth (JWT)

## Setup

### 1. Supabase

1. Create project at [supabase.com](https://supabase.com)
2. Get: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL`

### 2. Environment

```bash
# apps/backend/.env
DATABASE_URL=postgresql://...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
CORS_ORIGIN=http://localhost:3000

# apps/frontend/.env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_API_URL=http://localhost:4000
```

### 3. Install & Run

```bash
pnpm install
pnpm db:push          # Create tables (ต้องมี DATABASE_URL ที่เชื่อมต่อได้)
pnpm dev              # Frontend + Backend
```

**ถ้า DATABASE_URL error:**
- **ENOTFOUND** = เครือข่าย/IPv6 → ใช้ Session pooler แทน Direct
- **Tenant or user not found** = region ของ pooler ผิด → ต้อง copy จาก Dashboard:
  1. เปิด Supabase → กด **Connect** (ปุ่มบนขวา)
  2. เลือก **Session** หรือ **Transaction**
  3. Copy **Connection string** (URI) มาวางใน `apps/backend/.env` แทน `DATABASE_URL`
  4. รหัสผ่านที่มี `@` encode เป็น `%40`

**ถ้า `db:push` ไม่ได้เลย:** ใช้ SQL แทน
1. เปิด Supabase → SQL Editor
2. Copy `apps/backend/scripts/schema.sql` ไป Run
3. Run `apps/backend/scripts/rls.sql` (optional)

### 4. Seed (optional)

1. Create a user in Supabase Auth (Dashboard → Authentication → Users)
2. Copy the user UUID
3. Run: `cd apps/backend && SUPABASE_USER_ID=<uuid> pnpm exec tsx scripts/seed.ts`

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run frontend + backend |
| `pnpm dev:frontend` | Next.js only |
| `pnpm dev:backend` | Fastify only |
| `pnpm db:push` | Push schema to DB |
| `pnpm db:generate` | Generate migrations |

## Structure

```
/apps
  /frontend   — Next.js POS + Dashboard
  /backend    — Fastify API
/packages
  /shared     — Types + Zod schemas
```

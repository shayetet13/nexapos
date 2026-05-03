# NexaPos — คู่มือ Deploy (ฉบับละเอียด)

> **Stack:** Next.js 15 (Frontend) · Fastify 5 (Backend) · Cloudflare Worker (Edge) · Cloudflare Tunnel · Supabase (Database + Auth)

---

## ภาพรวม Architecture

```
มือถือ / คอมพิวเตอร์ (Browser)
         │
         ▼
┌─────────────────────────┐
│   Frontend (localhost)  │  พอร์ต 3010
│   Next.js 15            │
└────────────┬────────────┘
             │ เรียก API ผ่าน
             ▼
┌─────────────────────────┐
│  Cloudflare Worker      │  pos-cloud-worker.ipbpower.workers.dev
│  (Edge Gateway)         │  - กรอง CORS
└────────────┬────────────┘  - Rate limit
             │ ส่งต่อไปยัง
             ▼
┌─────────────────────────┐
│  Cloudflare Tunnel      │  backend.devnid.xyz (URL คงที่)
│  (cloudflared)          │  ↕ เชื่อมเครื่องที่บ้านกับ internet
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Backend (localhost)    │  พอร์ต 4000
│  Fastify 5              │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Supabase               │
│  PostgreSQL + Auth      │
└─────────────────────────┘
```

---

## สิ่งที่ต้องมีก่อน

| สิ่งที่ต้องมี | ลิงก์ | หมายเหตุ |
|---|---|---|
| Node.js 20+ | https://nodejs.org | ติดตั้งแบบ LTS |
| pnpm | `npm install -g pnpm` | รันใน terminal |
| Cloudflare account | https://cloudflare.com | สมัครฟรี |
| Domain ใน Cloudflare | Cloudflare Dashboard | ต้องย้าย nameserver มาที่ CF |
| Supabase account | https://supabase.com | สมัครฟรี |
| cloudflared | https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ | ดาวน์โหลด .exe สำหรับ Windows |

---

## Step 0 — สร้าง Secret Keys (ทำก่อนทุกอย่าง)

เปิด terminal แล้วรัน 2 คำสั่งนี้ บันทึกค่าที่ได้ไว้ในที่ปลอดภัย:

```bash
# INTERNAL_TOKEN — ใช้ยืนยันว่า request มาจาก Worker จริง
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# ENCRYPTION_KEY — เข้ารหัสข้อมูลการชำระเงิน (PromptPay, บัญชีธนาคาร)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

ตัวอย่างที่ได้:
```
INTERNAL_TOKEN  = a1b2c3d4e5f6...  (64 ตัวอักษร)
ENCRYPTION_KEY  = f6e5d4c3b2a1...  (64 ตัวอักษร)
```

> ⚠️ **สำคัญมาก** — ค่าทั้งสองต้องเก็บเป็นความลับ ห้ามใส่ใน code หรือ commit ขึ้น git

---

## Step 1 — ตั้งค่า Supabase

### 1.1 สร้าง Project

1. ไปที่ https://supabase.com → **New Project**
2. ตั้งชื่อ project, เลือก region **Southeast Asia (Singapore)**
3. ตั้ง Database Password → บันทึกไว้

### 1.2 เก็บค่า API Keys

ไปที่ **Settings → API** คัดลอกค่าเหล่านี้:

| ชื่อ | ที่อยู่ใน Dashboard | ใช้เป็น |
|---|---|---|
| Project URL | Settings → API → Project URL | `SUPABASE_URL` |
| anon public key | Settings → API → Project API keys → anon | `SUPABASE_ANON_KEY` |
| service_role key | Settings → API → Project API keys → service_role | `SUPABASE_SERVICE_ROLE_KEY` |

### 1.3 เก็บ Database URL

ไปที่ **Settings → Database → Connection → Transaction pooler** (port **6543**) → คัดลอก Connection String

ตัวอย่าง:
```
postgresql://postgres.abcdef:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

### 1.4 ตั้ง Auth Redirect URL

ไปที่ **Authentication → URL Configuration:**
- Site URL: `http://localhost:3010`
- Redirect URLs: `http://localhost:3010/auth/callback`

### 1.5 รัน Database Migration

```bash
cd C:\Users\Administrator\Desktop\Pos
pnpm db:migrate
```

---

## Step 2 — ตั้งค่า Environment Variables

### 2.1 Backend (.env)

สร้างไฟล์ `apps/backend/.env` (copy จาก `.env.example`):

```env
DATABASE_URL=postgresql://postgres.xxx:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
PORT=4000
CORS_ORIGIN=http://localhost:3010
ENCRYPTION_KEY=<64-hex-chars-จาก-Step-0>
INTERNAL_TOKEN=<64-hex-chars-จาก-Step-0>
```

### 2.2 Frontend (.env.local)

สร้างไฟล์ `apps/frontend/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
NEXT_PUBLIC_API_URL=https://pos-cloud-worker.YOUR_SUBDOMAIN.workers.dev
NEXT_PUBLIC_API_URL_DIRECT=https://backend.yourdomain.com
NEXT_PUBLIC_WS_URL=wss://backend.yourdomain.com
NEXT_PUBLIC_DEV_ADMIN_EMAILS=your@email.com
NEXT_PUBLIC_STRIPE_LINK_MONTHLY=https://buy.stripe.com/REPLACE
NEXT_PUBLIC_STRIPE_LINK_YEARLY=https://buy.stripe.com/REPLACE
```

---

## Step 3 — ตั้งค่า Cloudflare Tunnel (URL คงที่)

Tunnel คือสะพานเชื่อม backend ที่รันบนเครื่องที่บ้าน กับ internet — ทำให้ Cloudflare Worker เรียก backend ได้

### 3.1 Login Cloudflare

```bash
cloudflared tunnel login
```

> จะเปิด browser ให้ login Cloudflare → เลือก domain ที่ต้องการใช้ → **Authorize**

### 3.2 สร้าง Tunnel

```bash
cloudflared tunnel create pos-backend
```

> จะได้ Tunnel ID เช่น `bd867a5f-34e2-4212-9bbd-aed519f168cd` — บันทึกไว้

### 3.3 สร้าง DNS Route (ชี้ subdomain → Tunnel)

```bash
cloudflared tunnel route dns pos-backend backend.yourdomain.com
```

> แทน `yourdomain.com` ด้วย domain จริงที่มีใน Cloudflare

### 3.4 สร้าง Config File

สร้างไฟล์ `C:\Users\Administrator\.cloudflared\config.yml`:

```yaml
tunnel: <TUNNEL-ID-จาก-3.2>
credentials-file: C:\Users\Administrator\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: backend.yourdomain.com
    service: http://localhost:4000
  - service: http_status:404
```

### 3.5 ทดสอบ Tunnel

```bash
# รัน tunnel
cloudflared tunnel run pos-backend

# เปิด terminal ใหม่ ทดสอบ
curl https://backend.yourdomain.com/health
```

ถ้าได้ `{"success":false,"error":{"code":"AUTH_001"...}}` = Tunnel ทำงานปกติ ✅
(Error นี้ปกติ เพราะ `/health` ต้องการ internal token)

---

## Step 4 — ตั้งค่า Cloudflare Worker

### 4.1 ติดตั้ง Dependencies

```bash
cd apps/worker
pnpm install
```

### 4.2 Login Wrangler (ถ้ายังไม่ได้ login)

```bash
pnpm wrangler login
```

### 4.3 ตั้ง Secrets

รันทีละคำสั่ง ระบบจะถามให้ใส่ค่า:

```bash
# Internal token (ต้องตรงกับ Backend INTERNAL_TOKEN ทุกตัวอักษร)
pnpm wrangler secret put INTERNAL_TOKEN

# URL ของ backend (tunnel URL)
pnpm wrangler secret put ORIGIN_URL
# ใส่: https://backend.yourdomain.com

# URL ของ frontend
pnpm wrangler secret put FRONTEND_URL
# ใส่: http://localhost:3010  (dev) หรือ https://pos.yourdomain.com (prod)
```

### 4.4 Deploy Worker

```bash
pnpm wrangler deploy
```

> ได้ Worker URL เช่น `https://pos-cloud-worker.YOUR_SUBDOMAIN.workers.dev`

### 4.5 อัปเดต Frontend .env.local

แก้ไข `apps/frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=https://pos-cloud-worker.YOUR_SUBDOMAIN.workers.dev
```

---

## Step 5 — รันทั้งระบบ

### วิธีที่ 1 — รันด้วย start.bat (แนะนำ)

ดับเบิลคลิก `start.bat` — จะเปิดพร้อมกัน:
- Cloudflare Tunnel (`backend.yourdomain.com`)
- Frontend (`http://localhost:3010`)
- Backend (`http://localhost:4000`)

### วิธีที่ 2 — รันแยก terminal

```bash
# Terminal 1: Tunnel
cloudflared tunnel run pos-backend

# Terminal 2: Backend + Frontend
pnpm dev
```

---

## Step 6 — ตรวจสอบระบบ

```
□ Backend health     → curl http://localhost:4000/health
□ Tunnel health      → curl https://backend.yourdomain.com/health
□ Worker health      → curl https://pos-cloud-worker.xxx.workers.dev/health
□ Frontend           → เปิด http://localhost:3010 → หน้า login ขึ้น
□ Login              → ลอง login ด้วย email → redirect ถูกต้อง
□ WebSocket          → เปิด POS → customer display connect (ไม่มี WS error)
```

---

## Troubleshooting

| ปัญหา | สาเหตุ | วิธีแก้ |
|---|---|---|
| `530` จาก Worker | Tunnel ไม่ได้รัน | รัน `cloudflared tunnel run pos-backend` |
| `404` จาก Worker | Backend ไม่ได้รัน | รัน `pnpm dev:backend` |
| `401 Unauthorized` | `INTERNAL_TOKEN` ไม่ตรง | ตรวจสอบ token ทั้งสองฝั่งต้องเหมือนกันทุกตัวอักษร |
| Tunnel ตายกลางคัน | Process หยุด | ใช้ `start.bat` — เปิดทุกอย่างพร้อมกันครั้งเดียว |
| URL เปลี่ยนทุกครั้ง | ใช้ Quick Tunnel | ใช้ Named Tunnel ตาม Step 3 — URL คงที่ถาวร |
| WebSocket ต่อไม่ได้ | URL ผิด | ตรวจ `NEXT_PUBLIC_WS_URL` ต้องเป็น `wss://` |
| CORS error | `FRONTEND_URL` ใน Worker ผิด | `pnpm wrangler secret put FRONTEND_URL` ใส่ URL ที่ถูก |
| `500` Database error | `DATABASE_URL` ผิด | ตรวจ connection string และ Supabase RLS |

---

## เมื่อ ORIGIN_URL เปลี่ยน (กรณีย้ายเครื่องหรือ domain ใหม่)

```bash
cd apps/worker
echo "https://backend.newdomain.com" | pnpm wrangler secret put ORIGIN_URL
```

---

## Quick Reference

| บริการ | URL | หมายเหตุ |
|---|---|---|
| Frontend | http://localhost:3010 | รันบนเครื่อง |
| Backend | http://localhost:4000 | รันบนเครื่อง |
| Tunnel | https://backend.devnid.xyz | URL คงที่ผ่าน Cloudflare |
| Worker | https://pos-cloud-worker.ipbpower.workers.dev | Edge Gateway |
| Supabase | https://supabase.com/dashboard | Database + Auth |

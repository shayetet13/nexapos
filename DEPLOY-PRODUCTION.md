# คู่มือ Deploy Production — NexaPos
### ฉบับละเอียด สำหรับคนที่ไม่เคยทำมาก่อน

> อ่านทีละขั้นตอน ทำตามลำดับ **อย่าข้าม** แม้แต่ขั้นเดียว

---

## ภาพรวม Architecture

```
Browser / มือถือของลูกค้า
         │
         ▼
┌─────────────────────────┐
│  Vercel (Frontend)      │  ← Next.js 15  (pos.devnid.xyz)
└────────────┬────────────┘
             │ เรียก REST API
             ▼
┌─────────────────────────────────┐
│  Cloudflare Worker (API Gateway)│  ← กรอง CORS, rate-limit, internal token
│  pos-cloud-worker               │
└────────────┬────────────────────┘
             │ forward request
             ▼
┌─────────────────────────┐        ┌──────────────────────┐
│  Railway (Backend)      │───────▶│  Supabase (Database) │
│  Fastify 5 + WebSocket  │        │  PostgreSQL + Auth    │
└─────────────────────────┘        └──────────────────────┘

หมายเหตุ: WebSocket เชื่อม Browser → Railway โดยตรง (ไม่ผ่าน Worker)
```

---

## สิ่งที่ต้องมีก่อนเริ่ม

| สิ่งที่ต้องมี | ลิงก์ | หมายเหตุ |
|---|---|---|
| บัญชี GitHub | https://github.com | สมัครฟรี |
| บัญชี Railway | https://railway.app | สมัครฟรี (ใช้ GitHub login ได้) |
| บัญชี Vercel | https://vercel.com | สมัครฟรี (ใช้ GitHub login ได้) |
| บัญชี Cloudflare | https://cloudflare.com | มีอยู่แล้ว |
| บัญชี Supabase | https://supabase.com | มีอยู่แล้ว |
| Git ติดตั้งบนเครื่อง | https://git-scm.com/download/win | ดาวน์โหลด → ติดตั้ง → รีสตาร์ท terminal |
| Node.js 20+ | https://nodejs.org | LTS version |
| pnpm | รันคำสั่ง: `npm install -g pnpm` | หลังติดตั้ง Node.js |
| Wrangler CLI | รันคำสั่ง: `npm install -g wrangler` | สำหรับ Cloudflare Worker |

---

## ขั้นตอนที่ 0 — เตรียม Secret Keys

> ต้องทำก่อนทุกอย่าง — key เหล่านี้ต้องใส่ทั้งบน Railway และ Cloudflare Worker

เปิด Terminal (PowerShell หรือ Command Prompt) แล้วรันคำสั่งนี้ **2 ครั้ง** เพื่อสร้าง key 2 ตัว:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

ผลลัพธ์ที่ได้จะเป็นตัวเลข+อักษรยาว 64 ตัว เช่น:
```
a3f8c21e9d0b74561f2e8a3c7d4b9e02f1a6c8d3e5b7294f0a1c3e6d8b2f4a7
```

รัน 2 ครั้ง ได้ 2 ค่าที่ต่างกัน — **จดเก็บไว้ในที่ปลอดภัย:**

```
ENCRYPTION_KEY  = (ค่าจากครั้งที่ 1)
INTERNAL_TOKEN  = (ค่าจากครั้งที่ 2)
```

> ⚠️ **ห้ามใช้ค่าเดียวกันทั้งคู่** และ **ห้ามแชร์ให้ใคร**

---

## ขั้นตอนที่ 1 — Push Code ขึ้น GitHub

### 1.1 สร้าง Repository บน GitHub

1. เปิด https://github.com/new
2. กรอก **Repository name**: `nexapos`
3. เลือก **Private** (ไม่ใช่ Public)
4. **อย่าติ๊ก** Add README, .gitignore, license
5. กดปุ่ม **Create repository**
6. GitHub จะแสดงหน้า repository ว่าง — **copy URL** ที่แสดงอยู่ เช่น:
   ```
   https://github.com/yourusername/nexapos.git
   ```

### 1.2 ตรวจสอบ Git บนเครื่อง

เปิด Terminal แล้วรัน:

```bash
git --version
```

ต้องเห็น: `git version 2.x.x` — ถ้าไม่เห็น ให้ติดตั้ง Git ก่อน

### 1.3 ตั้งค่า Git (ถ้ายังไม่เคยทำ)

```bash
git config --global user.name "ชื่อของคุณ"
git config --global user.email "email@ของคุณ.com"
```

### 1.4 เข้าโฟลเดอร์โปรเจค

```bash
cd C:\Users\Administrator\Desktop\NexaPos
```

### 1.5 Initialize และ Push

รันทีละบรรทัด:

```bash
git init
```

```bash
git add .
```

```bash
git commit -m "initial commit"
```

```bash
git branch -M main
```

```bash
git remote add origin https://github.com/yourusername/nexapos.git
```

> ⚠️ แทน `yourusername` ด้วย GitHub username จริงของคุณ

```bash
git push -u origin main
```

GitHub อาจให้ login — ใส่ username และ Personal Access Token (ไม่ใช่รหัสผ่าน)

> **สร้าง Personal Access Token:** https://github.com/settings/tokens → Generate new token (classic) → ติ๊ก `repo` → Generate → copy ค่า

**ตรวจสอบ:** เปิด https://github.com/yourusername/nexapos — ต้องเห็นไฟล์โปรเจคทั้งหมด

---

## ขั้นตอนที่ 2 — Deploy Backend บน Railway

### 2.1 สมัคร / Login Railway

1. เปิด https://railway.app
2. กด **Login** → เลือก **Login with GitHub**
3. อนุญาต GitHub access

### 2.2 สร้าง Project ใหม่

1. กดปุ่ม **New Project** (ปุ่มสีม่วง)
2. เลือก **Deploy from GitHub repo**
3. ถ้าไม่เห็น repo → กด **Configure GitHub App** → เลือก repository `nexapos`
4. กลับมากด repo `nexapos`
5. Railway จะสร้าง service และเริ่ม build (จะ error ก่อน — ปกติ เพราะยังไม่ได้ตั้งค่า)

### 2.3 ตั้งค่า Service

1. คลิกที่ service ที่เพิ่งสร้าง
2. ไปที่แท็บ **Settings**
3. หา section **Build** แล้วตั้งค่า:

   | Field | ค่าที่ต้องใส่ |
   |---|---|
   | **Root Directory** | `apps/backend` |
   | **Build Command** | `cd ../.. && pnpm install && pnpm --filter=@nexapos/shared build && pnpm --filter=@nexapos/backend build` |
   | **Start Command** | `node dist/index.js` |

4. กด **Save**

### 2.4 ตั้งค่า Environment Variables

1. ไปที่แท็บ **Variables**
2. กด **New Variable** แล้วเพิ่มทีละตัวตามตารางนี้:

   | Variable | ค่า | ที่มา |
   |---|---|---|
   | `DATABASE_URL` | `postgresql://postgres.xxx:PASSWORD@...` | Supabase → Connect → Transaction Pooler → URI |
   | `SUPABASE_URL` | `https://xxx.supabase.co` | Supabase → Settings → API → Project URL |
   | `SUPABASE_ANON_KEY` | `eyJ...` | Supabase → Settings → API → anon/public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Supabase → Settings → API → service_role key |
   | `ENCRYPTION_KEY` | (ค่าจาก Step 0 ครั้งที่ 1) | 64 hex chars |
   | `INTERNAL_TOKEN` | (ค่าจาก Step 0 ครั้งที่ 2) | 64 hex chars |
   | `CORS_ORIGIN` | `https://pos.devnid.xyz` | URL Frontend (อัปเดตหลังได้ Vercel URL) |
   | `NODE_ENV` | `production` | พิมพ์เองได้เลย |
   | `PORT` | `4000` | พิมพ์เองได้เลย |
   | `NIXPACKS_NODE_VERSION` | `20` | บังคับให้ใช้ Node 20+ |
   | `LOG_LEVEL` | `info` | ระดับ log (debug/info/warn/error) |
   | `RESEND_API_KEY` | `re_xxx` | https://resend.com → API Keys |
   | `TELEGRAM_BOT_TOKEN` | `xxx:yyy` | BotFather ใน Telegram (ถ้าใช้) |
   | `DEV_ADMIN_EMAILS` | `your@email.com` | email ที่ต้องการให้เข้า /dev ได้ |

   **วิธีหา DATABASE_URL จาก Supabase:**
   - เปิด https://supabase.com/dashboard
   - เลือก project
   - กดปุ่ม **Connect** (ด้านบนขวา สีฟ้า)
   - เลือกแท็บ **Transaction pooler**
   - Copy URI ที่แสดง (มีหน้าตาแบบ `postgresql://postgres.xxx:PASSWORD@...pooler.supabase.com:6543/postgres`)
   - ⚠️ ถ้าใน password มีตัว `@` ให้เปลี่ยนเป็น `%40`

### 2.5 Redeploy

1. ไปที่แท็บ **Deployments**
2. กดปุ่ม **Deploy** หรือ **Redeploy** (ปุ่มขวาบน)
3. รอประมาณ 2-4 นาที — ดู log ที่แสดงขณะ build
4. ✅ สำเร็จเมื่อ log แสดง: `NexaPos Backend running at http://localhost:4000`

### 2.6 Copy URL ของ Backend

1. ไปที่แท็บ **Settings** → section **Networking**
2. กด **Generate Domain** (ใต้ Public Networking)
3. จะได้ URL เช่น: `pos-backend-production.up.railway.app`
4. **จด URL นี้ไว้** — ต้องใช้ในขั้นตอนถัดไปทุกขั้น

### 2.7 ทดสอบ Backend

เปิด browser หรือรันใน terminal:

```bash
curl https://pos-backend-production.up.railway.app/api/health
```

ต้องได้ response แบบนี้:
```json
{"ok":true,"timestamp":"...","requestId":"..."}
```

ถ้าได้ = Backend พร้อมใช้งาน ✅

---

## ขั้นตอนที่ 3 — Run Database Migrations

> ⚠️ **ต้องทำก่อน deploy frontend** — ถ้าข้ามขั้นนี้ app จะ crash เพราะไม่มี table ในฐานข้อมูล

### 3.1 สร้างไฟล์ .env สำหรับ migration

เปิด Terminal แล้วเข้าโฟลเดอร์ backend:

```bash
cd C:\Users\Administrator\Desktop\NexaPos\apps\backend
```

สร้างไฟล์ `.env` (ใช้แค่ตอน migrate ไม่ commit ขึ้น git):

```bash
# สร้างไฟล์ .env ด้วย Notepad หรือ VS Code
# ใส่เนื้อหาดังนี้:
DATABASE_URL=postgresql://postgres.xxx:PASSWORD@...pooler.supabase.com:6543/postgres
```

> ใช้ค่า DATABASE_URL เดียวกับที่ใส่บน Railway ใน Step 2.4

### 3.2 ติดตั้ง dependencies

กลับไปที่ root ของโปรเจค:

```bash
cd C:\Users\Administrator\Desktop\NexaPos
pnpm install
```

### 3.3 Run migrations

```bash
pnpm db:migrate
```

ต้องเห็น output แบบนี้:
```
[✓] Applied 0000_init.sql
[✓] Applied 0001_add_branch_id_to_user_shop_roles.sql
[✓] Applied 0002_add_is_active_to_branches.sql
...
[✓] Applied 0019_add_audit_logs.sql
Migration completed successfully
```

> ถ้าเจอ error `relation already exists` = migration บางตัวรันไปแล้ว → ปกติ ไม่ต้องตกใจ

### 3.4 ลบไฟล์ .env (สำคัญมาก)

```bash
del C:\Users\Administrator\Desktop\NexaPos\apps\backend\.env
```

> ⚠️ ห้ามปล่อยไฟล์ .env ไว้ในเครื่อง และ **ห้าม commit** ขึ้น GitHub เด็ดขาด

---

## ขั้นตอนที่ 4 — ตั้งค่า Cloudflare Worker

Worker ทำหน้าที่เป็น API gateway — ต้องบอกให้รู้ว่า backend อยู่ที่ Railway URL ไหน

### 4.1 ตรวจสอบ Wrangler CLI

```bash
wrangler --version
```

ถ้าไม่มี ให้ติดตั้ง:
```bash
npm install -g wrangler
```

### 4.2 Login Cloudflare

```bash
wrangler login
```

Browser จะเปิดขึ้นมา → กด **Allow** เพื่ออนุญาต → กลับมาที่ terminal จะเห็น "Successfully logged in"

### 4.3 เข้าโฟลเดอร์ Worker

```bash
cd C:\Users\Administrator\Desktop\NexaPos\apps\worker
```

### 4.4 สร้าง KV Namespace (ถ้า deploy บน Cloudflare account ใหม่)

Worker ใช้ KV storage สำหรับ edge cache ต้องสร้างก่อน:

```bash
wrangler kv namespace create "CACHE"
```

จะได้ผลลัพธ์แบบนี้:
```
✅ Successfully created KV namespace "CACHE"
Add the following to your wrangler.toml:
[[kv_namespaces]]
binding = "CACHE"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

**จด id ที่ได้** แล้วเปิดไฟล์ `wrangler.toml` และแก้ค่า `id` ให้ตรง:

```toml
[[kv_namespaces]]
binding    = "CACHE"
id         = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"   ← แทนด้วย id ที่ได้จากคำสั่งด้านบน
```

> ถ้าใช้ account เดิมที่ KV มีอยู่แล้ว ข้ามขั้นนี้ได้

### 4.5 ตั้งค่า Secrets ทั้งหมดบน Worker (ครั้งเดียว)

รองรับการย้าย secrets ขึ้น Worker ครบชุด โดยไม่ต้องพิมพ์คำสั่งทีละตัว:

```bash
cd C:\Users\Administrator\Desktop\NexaPos\apps\worker
pnpm secrets:set
```

สคริปต์จะถามค่า secret ทีละตัว (ค่าไม่ถูกเขียนลงไฟล์ใน repo):
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_KEY`
- `INTERNAL_TOKEN`
- `ORIGIN_URL`
- `FRONTEND_URL`
- `RESEND_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `DEV_ADMIN_EMAILS`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

> หมายเหตุสำคัญ: การเก็บใน Worker เป็น secure storage ที่ Cloudflare แต่ backend บน Railway ยังต้องมี env ที่จำเป็นของตัวเองเพื่อรันได้ปกติ

### 4.6 Deploy Worker

```bash
cd C:\Users\Administrator\Desktop\NexaPos
pnpm deploy:worker
```

รอสักครู่ — เมื่อสำเร็จจะแสดง:
```
Deployed pos-cloud-worker triggers (X sec)
  https://pos-cloud-worker.ipbpower.workers.dev
```

### 4.7 ทดสอบ Worker

```bash
curl https://pos-cloud-worker.ipbpower.workers.dev/api/v1/auth/status
```

ต้องได้ response (อาจเป็น 401 Unauthorized — ปกติ แสดงว่า Worker ทำงานแล้ว)

---

## ขั้นตอนที่ 5 — Deploy Frontend บน Vercel

### 5.1 สมัคร / Login Vercel

1. เปิด https://vercel.com
2. กด **Sign Up** → เลือก **Continue with GitHub**
3. อนุญาต GitHub access

### 5.2 Import Project

1. กด **Add New...** → **Project**
2. เลือก **Import Git Repository**
3. หา repo `nexapos` → กด **Import**
4. **สำคัญมาก** — ก่อนกด Deploy ต้องแก้ไขก่อน:

### 5.3 ตั้งค่า Root Directory

ใน หน้า Configure Project:
1. กด **Edit** ที่ **Root Directory**
2. เปลี่ยนจาก `/` เป็น `apps/frontend`
3. กด **Continue**

### 5.4 ตั้งค่า Build Settings

ตรวจสอบและแก้ไขให้ตรงนี้:

| Field | ค่าที่ต้องใส่ |
|---|---|
| Framework Preset | Next.js |
| Root Directory | `apps/frontend` |
| Build Command | `cd ../.. && pnpm install && pnpm --filter=@nexapos/shared build && pnpm --filter=@nexapos/frontend build` |
| Output Directory | `.next` |
| Install Command | _(ปล่อยว่างไว้ — จัดการใน Build Command แล้ว)_ |

> ⚠️ **สำคัญ:** ต้องใช้ Build Command ด้านบน ไม่ใช่แค่ `next build` เพราะโปรเจคใช้ pnpm workspaces และต้อง build shared package ก่อน

### 5.5 ตั้งค่า Environment Variables

เลื่อนลงหา **Environment Variables** แล้วเพิ่มทีละตัว:

| Variable | ค่า | หมายเหตุ |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | anon/public key |
| `NEXT_PUBLIC_API_URL` | `https://pos-cloud-worker.ipbpower.workers.dev` | ผ่าน CF Worker |
| `NEXT_PUBLIC_API_URL_DIRECT` | `https://pos-backend-production.up.railway.app` | ตรง Railway |
| `NEXT_PUBLIC_WS_URL` | `wss://pos-backend-production.up.railway.app` | ⚠️ ต้อง `wss://` ไม่ใช่ `https://` |
| `NEXT_PUBLIC_DEV_ADMIN_EMAILS` | `your@email.com` | email ที่ให้เข้า /dev ได้ |
| `NEXT_PUBLIC_STRIPE_LINK_MONTHLY` | `https://buy.stripe.com/xxx` | Stripe Payment Link (ถ้ามี) |
| `NEXT_PUBLIC_STRIPE_LINK_YEARLY` | `https://buy.stripe.com/xxx` | Stripe Payment Link (ถ้ามี) |

### 5.6 กด Deploy

1. กดปุ่ม **Deploy**
2. รอประมาณ 3-5 นาที — ดู build log
3. ✅ สำเร็จเมื่อเห็น "Congratulations!" หรือ Build เป็นสีเขียว

### 5.7 Copy Vercel URL

Vercel จะให้ URL เช่น: `nexapos-abc123.vercel.app`
**จด URL นี้ไว้**

---

## ขั้นตอนที่ 6 — ตั้ง Custom Domain บน Vercel (ถ้าต้องการ)

> ข้ามขั้นนี้ได้ถ้าใช้ URL จาก Vercel ตรงๆ

1. Vercel → เลือก project → **Settings** → **Domains**
2. พิมพ์ domain: `pos.devnid.xyz` → กด **Add**
3. Vercel จะแสดง DNS record ที่ต้องเพิ่ม เช่น:
   ```
   Type: CNAME
   Name: pos
   Value: cname.vercel-dns.com
   ```
4. เปิด Cloudflare Dashboard → เลือก `devnid.xyz` → **DNS** → **Add record**
5. เพิ่ม record ตามที่ Vercel บอก
6. รอ 1-5 นาที → Vercel จะแสดง ✅ เมื่อ domain พร้อม

---

## ขั้นตอนที่ 7 — อัปเดต CORS บน Railway

หลังได้ Vercel URL จริงแล้ว ต้องอัปเดต CORS ให้ backend รู้จัก:

1. Railway → project → service → **Variables**
2. หา `CORS_ORIGIN` → กด Edit
3. ใส่ค่าใหม่ (ถ้ามีหลาย URL คั่นด้วยคอมม่า ไม่มีช่องว่าง):
   ```
   https://pos.devnid.xyz,https://nexapos-abc123.vercel.app
   ```
4. กด **Save**
5. Railway จะ redeploy อัตโนมัติ — รอประมาณ 2 นาที

---

## ขั้นตอนที่ 8 — ทดสอบ Production ทั้งระบบ

### ทดสอบ Backend โดยตรง
```bash
curl https://pos-backend-production.up.railway.app/api/health
```
ต้องได้: `{"ok":true,...}`

### ทดสอบ Worker → Backend
```bash
curl https://pos-cloud-worker.ipbpower.workers.dev/api/v1/auth/status
```
ต้องได้ response JSON (อาจเป็น 401 — ปกติ)

### ทดสอบ Frontend
1. เปิด browser → ไปที่ `https://pos.devnid.xyz` (หรือ Vercel URL)
2. ลอง Login ด้วยบัญชีที่มีอยู่
3. เปิด DevTools (F12) → Console → ต้องไม่มี CORS error สีแดง
4. ลองสร้างออเดอร์ทดสอบ
5. เปิดหน้า `/pay?shopId=xxx` ด้วยหน้าต่างอื่น — Customer Display ต้องโชว์ "รอการชำระเงิน"
6. กดชำระเงินที่ POS → Customer Display ต้องแสดงยอดรวมทันที (WebSocket real-time)

---

## ขั้นตอนที่ 9 — Auto Deploy (CD) ทุกครั้งที่แก้โค้ด

หลังตั้งค่าครบแล้ว เวลาแก้โค้ดแล้วต้องการ deploy ใหม่:

```bash
cd C:\Users\Administrator\Desktop\NexaPos
```

```bash
git add .
```

```bash
git commit -m "fix: อธิบายสิ่งที่แก้"
```

```bash
git push
```

หลังรัน `git push`:
- **Vercel** จะ build + deploy frontend ใหม่อัตโนมัติ ~3-5 นาที
- **Railway** จะ build + deploy backend ใหม่อัตโนมัติ ~2-3 นาที

> ⚠️ Worker **ไม่** auto-deploy — ต้องรัน `pnpm deploy:worker` เองทุกครั้งที่แก้ไขโค้ด Worker

ดู status ได้ที่:
- Vercel: https://vercel.com/dashboard
- Railway: https://railway.app/dashboard

---

## Troubleshooting — แก้ปัญหาที่พบบ่อย

### ❌ Railway build ล้มเหลว: "Cannot find module '@nexapos/shared'"
**สาเหตุ:** shared package ไม่ได้ build ก่อน
**แก้:** ตรวจสอบ Build Command ใน Railway ให้ตรงกับ Step 2.3 — ต้องมี `pnpm --filter=@nexapos/shared build` ก่อน

### ❌ Railway ขึ้น "Missing environment variable"
**สาเหตุ:** ลืมใส่ env variable ตัวใดตัวหนึ่ง
**แก้:** ไป Variables → ตรวจทีละตัวตามตารางใน Step 2.4

### ❌ Migration ล้มเหลว: "password authentication failed"
**สาเหตุ:** DATABASE_URL ใน `.env` ผิด หรือรหัสผ่านมีอักขระพิเศษ
**แก้:** ตรวจสอบ URL อีกครั้ง — ถ้า password มี `@` ให้เปลี่ยนเป็น `%40`

### ❌ Vercel build ล้มเหลว: "Cannot find module '@nexapos/shared'"
**สาเหตุ:** Build Command ไม่ถูกต้อง
**แก้:** ตรวจสอบ Build Command ใน Vercel ให้ตรงกับ Step 5.4

### ❌ Frontend ขึ้น "Failed to fetch" / ไม่สามารถ login ได้
**สาเหตุ:** `NEXT_PUBLIC_API_URL` ผิด หรือ Worker ยังไม่ได้ตั้งค่า
**แก้:** ตรวจสอบ env variable บน Vercel และรัน Step 4 ใหม่

### ❌ CORS Error ใน browser console
**สาเหตุ:** `CORS_ORIGIN` บน Railway ไม่มี URL ของ Vercel
**แก้:** อัปเดต `CORS_ORIGIN` ตาม Step 7

### ❌ WebSocket ต่อไม่ได้ (real-time ไม่ทำงาน)
**สาเหตุ:** `NEXT_PUBLIC_WS_URL` ผิด
**แก้:** ต้องเป็น `wss://` ไม่ใช่ `https://` และชี้ไปที่ Railway URL โดยตรง (ไม่ผ่าน Worker)

### ❌ Cloudflare Worker ตอบ 500 / 502
**สาเหตุ:** `ORIGIN_URL` หรือ `INTERNAL_TOKEN` ผิด หรือ KV namespace ไม่ตรง
**แก้:** รัน Step 4.4–4.8 ใหม่ ตรวจสอบ id ใน wrangler.toml

### ❌ Worker error: "KV namespace not found"
**สาเหตุ:** ใช้ Cloudflare account ใหม่ แต่ยังใช้ KV id เดิมใน wrangler.toml
**แก้:** รัน Step 4.4 เพื่อสร้าง KV namespace ใหม่ แล้วอัปเดต id ใน wrangler.toml

### ❌ git push แล้วถามรหัสผ่าน GitHub ทุกครั้ง
**แก้:** ใช้ Personal Access Token แทนรหัสผ่าน (ดู Step 1.5) หรือตั้งค่า SSH key

---

## Summary — URL และ Service ทั้งหมด

| Service | URL | ใช้ทำอะไร |
|---|---|---|
| Frontend | `https://pos.devnid.xyz` | หน้าเว็บ POS |
| Backend | `https://pos-backend-production.up.railway.app` | API Server |
| API Gateway | `https://pos-cloud-worker.ipbpower.workers.dev` | กรอง request |
| Database | Supabase Dashboard | ไม่ต้อง expose |

---

## Checklist ก่อน Go Live

- [ ] Backend health check ผ่าน (`/api/health` ตอบ `{"ok":true}`) ✅
- [ ] Migration รันครบ ไม่มี error ✅
- [ ] Frontend login ได้ ✅
- [ ] ไม่มี CORS error ใน browser console ✅
- [ ] สร้างออเดอร์ทดสอบได้ ✅
- [ ] WebSocket real-time ทำงาน (Customer Display รับยอดทันที) ✅
- [ ] หน้า `/pay` ไม่โชว์ปุ่มเปลี่ยนธีม ✅
- [ ] URL `/dev` เข้าได้แค่ email ที่กำหนดใน `DEV_ADMIN_EMAILS` ✅
- [ ] ลบออเดอร์ทดสอบออก ✅

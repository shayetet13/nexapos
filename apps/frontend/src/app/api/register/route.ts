/**
 * app/api/register/route.ts
 * Proxy สำหรับ POST /auth/register — สมัครสมาชิก (ต้องมี verified_token)
 * Server-side proxy เพื่อหลีกเลี่ยง CORS จาก Cloudflare Worker
 */
import type { NextRequest } from 'next/server';
import { proxyRegisterRequest } from './_proxy';

export async function POST(req: NextRequest) {
  return proxyRegisterRequest(req, '/api/v1/auth/register');
}

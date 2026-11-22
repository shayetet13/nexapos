/**
 * app/api/register/request-otp/route.ts
 * Proxy สำหรับ POST /auth/register/request-otp — ส่ง OTP ไปยัง email ที่กรอก
 * Server-side proxy เพื่อหลีกเลี่ยง CORS จาก Cloudflare Worker
 */
import type { NextRequest } from 'next/server';
import { proxyRegisterRequest } from '../_proxy';

export async function POST(req: NextRequest) {
  return proxyRegisterRequest(req, '/api/v1/auth/register/request-otp');
}

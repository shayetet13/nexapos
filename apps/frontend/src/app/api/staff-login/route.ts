/**
 * app/api/staff-login/route.ts
 * Proxy สำหรับ POST /auth/staff-login — ส่ง nickname + PIN ไปยัง backend (v2: ไม่มี shopId)
 * ไม่ต้องการ auth token (public endpoint)
 * Backend ค้นหาร้าน/สาขาจาก nickname ที่ unique ทั้งระบบ
 */
import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL =
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4000';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const upstream = await fetch(`${BACKEND_URL}/api/v1/auth/staff-login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    const json = await upstream.json();
    return NextResponse.json(json, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { success: false, error: { message: 'ไม่สามารถเชื่อมต่อระบบได้' } },
      { status: 503 },
    );
  }
}

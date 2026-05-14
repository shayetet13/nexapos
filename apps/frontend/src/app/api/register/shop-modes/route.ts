import { NextResponse } from 'next/server';

const BACKEND_URL =
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL_DIRECT ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4000';

export async function GET() {
  try {
    const res  = await fetch(`${BACKEND_URL}/api/v1/public/shop-modes`, {
      signal: AbortSignal.timeout(5_000),
    });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch {
    return NextResponse.json(
      { success: false, error: { message: 'ไม่สามารถเชื่อมต่อระบบได้' } },
      { status: 503 },
    );
  }
}

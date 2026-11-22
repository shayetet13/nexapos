import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const BACKEND_URL =
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL_DIRECT ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4000';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? '';

export async function proxyRegisterRequest(
  req: NextRequest,
  upstreamPath: string,
) {
  try {
    const body = await req.json();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (INTERNAL_TOKEN) headers['X-Internal-Token'] = INTERNAL_TOKEN;

    const upstream = await fetch(`${BACKEND_URL}${upstreamPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
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

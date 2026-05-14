/**
 * Centralized environment config for the frontend.
 * Import API_URL and WS_URL from here — never use process.env directly in components.
 *
 * NEXT_PUBLIC_USE_PROXY=true  — browser ใช้ relative URL ('/api/v1/...') ผ่าน Next.js rewrite
 *   → ใช้เมื่อ mobile/LAN เข้าถึง Next.js server แล้วต้องการให้ backend ถูก proxy
 *   → BACKEND_URL ใน .env.local ต้องชี้ Fastify จริง (เช่น http://localhost:4000)
 *
 * NEXT_PUBLIC_LOCAL_API_URL   — override โดยตรงไป Fastify (เฉพาะเครื่องเดียวกันกับ server)
 *
 * API_URL_DIRECT  — Fastify จริง (ใช้สำหรับ WS broadcast ที่ต้อง in-process)
 */
export const API_URL =
  process.env.NEXT_PUBLIC_USE_PROXY === 'true'
    ? ''  // relative URL → Next.js rewrite → BACKEND_URL (ทุก device บน LAN ใช้ได้)
    : (process.env.NEXT_PUBLIC_LOCAL_API_URL?.trim() ||
       process.env.NEXT_PUBLIC_API_URL ||
       'http://localhost:4000');

/** Direct backend — ใช้เมื่อต้องการให้ WS broadcast ทำงานได้ เช่น withdrawal, pay display */
export const API_URL_DIRECT = process.env.NEXT_PUBLIC_API_URL_DIRECT ?? API_URL;

export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ??
  (API_URL ? API_URL.replace(/^http/, 'ws') : 'ws://localhost:4000');

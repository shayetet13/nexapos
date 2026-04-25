/**
 * Centralized environment config for the frontend.
 * Import API_URL and WS_URL from here — never use process.env directly in components.
 *
 * API_URL_DIRECT  — backend จริง (Fastify) ใช้สำหรับ WebSocket + endpoints ที่ต้อง broadcast
 * API_URL         — Cloudflare Worker proxy (ใช้สำหรับ REST ทั่วไปที่ไม่ต้อง real-time)
 *
 * NEXT_PUBLIC_LOCAL_API_URL — ถ้าตั้ง (เช่น http://localhost:4000) จะ override NEXT_PUBLIC_API_URL
 * เพื่อให้แอดมิน / ล็อกอินพนักงาน / pos-assignment ชี้ backend เดียวกับ BACKEND_URL ของ Next proxy
 * ไม่เช่นนั้น dev ที่ยังใช้ NEXT_PUBLIC_API_URL=production จะสร้างพนักงานบน prod แต่ staff-login ไป local → ค้นหา nickname ไม่เจอ
 */
export const API_URL =
  process.env.NEXT_PUBLIC_LOCAL_API_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:4000';

/** Direct backend — ใช้เมื่อต้องการให้ WS broadcast ทำงานได้ เช่น withdrawal, pay display */
export const API_URL_DIRECT = process.env.NEXT_PUBLIC_API_URL_DIRECT ?? API_URL;

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? API_URL.replace(/^http/, 'ws');

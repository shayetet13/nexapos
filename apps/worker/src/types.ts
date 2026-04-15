/** Cloudflare Worker environment bindings */
export interface Env {
  /** KV namespace for edge response cache */
  CACHE: KVNamespace;
  /** Rate limiter binding — optional (configure via CF Dashboard rule instead) */
  RATE_LIMITER?: RateLimit;

  /* ── Secrets (wrangler secret put) ── */
  /** Shared secret for internal origin calls; must match Fastify X-Internal-Token */
  INTERNAL_TOKEN: string;
  /** Fastify backend base URL, e.g. https://nexaposbackend-production.up.railway.app */
  ORIGIN_URL: string;
  /** Next.js frontend base URL for CORS */
  FRONTEND_URL: string;
  /** CF Access Service Token — Client ID (optional, required if backend behind CF Access) */
  CF_ACCESS_CLIENT_ID?: string;
  /** CF Access Service Token — Client Secret (optional, required if backend behind CF Access) */
  CF_ACCESS_CLIENT_SECRET?: string;

  /** Optional secret mirror values (kept in Worker Secrets store) */
  DATABASE_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ENCRYPTION_KEY?: string;
  RESEND_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  DEV_ADMIN_EMAILS?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;

  /* ── Vars ── */
  ENVIRONMENT: string;
}

/** Minimal JWT payload (decoded without verification — Supabase uses ES256) */
export interface JwtPayload {
  sub?: string;
  shop_id?: string;
  role?: string;
  exp?: number;
}

/** Parsed route params extracted from URL pattern matching */
export interface RouteParams {
  shopId?: string;
  [key: string]: string | undefined;
}

FROM node:24-alpine

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
WORKDIR /workspace

COPY . .
RUN pnpm install --frozen-lockfile

# Vite inlines VITE_* variables at build time, not runtime, so the API's
# public URL has to be known before this RUN step -- Railway passes every
# configured service Variable as a matching-named build ARG automatically.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @linebot/dashboard build

EXPOSE 4173
# "::" (not "0.0.0.0") -- confirmed via `railway ssh` that the app was up and
# reachable on 0.0.0.0 from inside the container, but Railway's edge still
# 502'd. "0.0.0.0" binds IPv4-only; Railway's proxy connects over IPv6, so an
# IPv4-only listener is invisible to it. "::" is the IPv6 wildcard, which on
# Linux dual-stacks to accept IPv4 connections too.
CMD ["pnpm", "--filter", "@linebot/dashboard", "preview", "--host", "::", "--port", "4173"]

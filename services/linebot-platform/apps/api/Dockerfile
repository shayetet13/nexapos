FROM node:24-bookworm-slim

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
WORKDIR /workspace

COPY . .
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=development
ENV API_HOST=0.0.0.0
EXPOSE 8787

# Keep the workspace sources available because Supervisor forks one TypeScript
# entry point per bot using Node's built-in type stripping.
CMD ["pnpm", "--filter", "@linebot/api", "start"]

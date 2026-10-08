# network-tutor-web — Next.js, pnpm. Runs the same `next start` systemd already uses.
# NOTE: the project's own "build" script also runs a DB migration (`tsx lib/db/migrate`) first —
# deliberately NOT run here. Migrations stay a separate, explicit operational step, never baked
# into an image build.
FROM node:22-slim AS builder
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec next build

FROM node:22-slim
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# drop the package's own "prepare": "husky" script for this stage — that's a dev-only
# git-hooks setup step; husky itself is a devDependency so it's absent from a --prod install
# and the script would just fail trying to run a binary that was never installed here.
RUN npm pkg delete scripts.prepare
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3400
CMD ["pnpm", "exec", "next", "start", "-p", "3400"]

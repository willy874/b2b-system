# ── build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /repo

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
# 根目錄的 prepare 是 lefthook install：映像裡沒有 git，也不需要 git hooks
RUN npm pkg delete scripts.prepare
COPY packages/utils/package.json packages/utils/
COPY packages/api-sdk/package.json packages/api-sdk/
COPY packages/realtime/package.json packages/realtime/
COPY apps/auth/package.json apps/auth/
RUN pnpm install --frozen-lockfile --filter @b2b-system/auth...

COPY packages ./packages
COPY apps/auth ./apps/auth
RUN pnpm --filter @b2b-system/utils build \
 && pnpm --filter @b2b-system/api-sdk build \
 && pnpm --filter @b2b-system/realtime build \
 && pnpm --filter @b2b-system/auth build

# ── runtime ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime
COPY deploy/nginx.auth.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/auth/dist /usr/share/nginx/html
EXPOSE 80

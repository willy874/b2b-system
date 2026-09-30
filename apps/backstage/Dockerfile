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
COPY apps/backstage/package.json apps/backstage/
RUN pnpm install --frozen-lockfile --filter @b2b-system/backstage...

# SSO 的網址在建置時寫進產物（Vite 的 import.meta.env）：apps/auth 的 origin 與 issuer（docs/architecture/04-sso.md §7）
ARG VITE_OIDC_ISSUER
ARG VITE_AUTH_APP_URL
ENV VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER VITE_AUTH_APP_URL=$VITE_AUTH_APP_URL

COPY packages ./packages
COPY apps/backstage ./apps/backstage
RUN pnpm --filter @b2b-system/utils build \
 && pnpm --filter @b2b-system/api-sdk build \
 && pnpm --filter @b2b-system/realtime build \
 && pnpm --filter @b2b-system/backstage build

# ── runtime ──────────────────────────────────────────────────────────
# 非 root（uid 101）的 nginx：pid 與暫存檔在 /tmp，listen 8080
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY deploy/nginx.main.conf /etc/nginx/nginx.conf
COPY deploy/nginx.security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/backstage/dist /usr/share/nginx/html
EXPOSE 8080

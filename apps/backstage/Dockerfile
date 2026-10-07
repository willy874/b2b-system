# ── build ────────────────────────────────────────────────────────────
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /repo

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
# 根目錄的 prepare 是 lefthook install：映像裡沒有 git，也不需要 git hooks
RUN npm pkg delete scripts.prepare
COPY packages/api-sdk/package.json packages/api-sdk/
COPY packages/realtime/package.json packages/realtime/
COPY packages/error-codes/package.json packages/error-codes/
COPY packages/web-shared/package.json packages/web-shared/
COPY packages/ui/package.json packages/ui/
COPY packages/web-core/package.json packages/web-core/
COPY apps/backstage/package.json apps/backstage/
RUN pnpm install --frozen-lockfile --filter @b2b-system/backstage...

# SSO 的網址在建置時寫進產物（Vite 的 import.meta.env）：apps/platform 的 origin 與 issuer（docs/architecture/04-sso.md §7）
ARG VITE_OIDC_ISSUER
ARG VITE_PLATFORM_APP_URL
ENV VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER VITE_PLATFORM_APP_URL=$VITE_PLATFORM_APP_URL

COPY packages ./packages
COPY apps/backstage ./apps/backstage
RUN pnpm --filter @b2b-system/api-sdk build \
 && pnpm --filter @b2b-system/error-codes build \
 && pnpm --filter @b2b-system/realtime build \
 && pnpm --filter @b2b-system/backstage build

# ── runtime ──────────────────────────────────────────────────────────
# 非 root（uid 101）的 nginx：pid 與暫存檔在 /tmp，listen 8080
FROM nginxinc/nginx-unprivileged:1.30.5-alpine@sha256:15c994d10d6d78658721c3bcafff14cb281fba2a4bdf9d5ba92c416a472516e3 AS runtime
COPY deploy/nginx.main.conf /etc/nginx/nginx.conf
COPY deploy/nginx.security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
# 啟動時依 TRUSTED_PROXY_CIDRS 產生 real_ip 設定（docs/architecture/01-system.md §4.2）
COPY --chmod=755 deploy/nginx-real-ip.sh /docker-entrypoint.d/15-real-ip.sh
# 獨立的檔案網域：CSP 放行它、產生檔案網域的 server（FILE_DOWNLOAD_ORIGIN；docs/architecture/backend/09-file.md §3.2）
COPY --chmod=755 deploy/nginx-file-origin.sh /docker-entrypoint.d/16-file-origin.sh
ENV FILES_SERVER=1
COPY --from=build /repo/apps/backstage/dist /usr/share/nginx/html
EXPOSE 8080

# worker 卡住時 compose 才看得出來（容器還在跑不代表 nginx 還在回應）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/_nginx_health || exit 1

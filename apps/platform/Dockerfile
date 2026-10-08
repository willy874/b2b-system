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
COPY packages/rich-text/package.json packages/rich-text/
COPY apps/platform/package.json apps/platform/
RUN pnpm install --frozen-lockfile --filter @b2b-system/platform...

# SSO 的網址在建置時寫進產物（Vite 的 import.meta.env）：apps/platform 的 origin 與 issuer（docs/architecture/04-sso.md §7）
ARG VITE_OIDC_ISSUER
ARG VITE_PLATFORM_APP_URL
ENV VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER VITE_PLATFORM_APP_URL=$VITE_PLATFORM_APP_URL
# 前端錯誤回報（docs/architecture/frontend/19-observability.md §3）：release 是 commit；DSN 在執行時以網域組成
ARG APP_RELEASE=unknown
# VITE_APM_ENABLED=false：APM 整套關閉，不初始化錯誤回報（docs/architecture/07-apm-service.md §8.1）
ARG VITE_APM_ENABLED=true
ARG VITE_APM_PROJECT_ID
ARG VITE_APM_PUBLIC_KEY
ARG VITE_APM_TRACES_SAMPLE_RATE=0.1
ENV APP_RELEASE=$APP_RELEASE VITE_APM_ENABLED=$VITE_APM_ENABLED VITE_APM_PROJECT_ID=$VITE_APM_PROJECT_ID \
    VITE_APM_PUBLIC_KEY=$VITE_APM_PUBLIC_KEY VITE_APM_TRACES_SAMPLE_RATE=$VITE_APM_TRACES_SAMPLE_RATE BUILD_SOURCEMAP=hidden

COPY packages ./packages
COPY apps/platform ./apps/platform
# sourcemap 不進正式映像：建置後搬到 /sourcemaps，由下面的 sourcemaps stage 匯出、上傳到 apm-service
# （docs/architecture/07-apm-service.md §5）
RUN pnpm --filter @b2b-system/api-sdk build \
 && pnpm --filter @b2b-system/error-codes build \
 && pnpm --filter @b2b-system/realtime build \
 && pnpm --filter @b2b-system/rich-text build \
 && pnpm --filter @b2b-system/platform build \
 && mkdir -p /sourcemaps \
 && cd apps/platform/dist \
 && find . -name '*.map' -exec sh -c 'mkdir -p "/sourcemaps/$(dirname "$1")" && mv "$1" "/sourcemaps/$1"' _ {} \;

# ── sourcemaps（docker build --target sourcemaps --output type=local,dest=<資料夾>）────
FROM scratch AS sourcemaps
COPY --from=build /sourcemaps /

# ── runtime ──────────────────────────────────────────────────────────
# 非 root（uid 101）的 nginx：pid 與暫存檔在 /tmp，listen 8080
FROM nginxinc/nginx-unprivileged:1.30.5-alpine@sha256:15c994d10d6d78658721c3bcafff14cb281fba2a4bdf9d5ba92c416a472516e3 AS runtime
COPY deploy/nginx.main.conf /etc/nginx/nginx.conf
COPY deploy/nginx.security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY deploy/nginx.platform.conf /etc/nginx/conf.d/default.conf
# 啟動時依 TRUSTED_PROXY_CIDRS 產生 real_ip 設定（docs/architecture/01-system.md §4.2）
# api 的 upstream：位址可由 API_UPSTREAM／REALTIME_UPSTREAM 指定（docs/architecture/01-system.md §7 D12）
COPY --chmod=755 deploy/nginx-upstreams.sh /docker-entrypoint.d/14-upstreams.sh
ENV API_UPSTREAM_KEEPALIVE=32
COPY --chmod=755 deploy/nginx-real-ip.sh /docker-entrypoint.d/15-real-ip.sh
# 獨立的檔案網域：CSP 放行它（FILE_DOWNLOAD_ORIGIN；docs/architecture/backend/09-file.md §3.2）
COPY --chmod=755 deploy/nginx-file-origin.sh /docker-entrypoint.d/16-file-origin.sh
# APM 的開關與解析 apm-service 的 resolver（APM_ENABLED；docs/architecture/07-apm-service.md §8.1）
COPY --chmod=755 deploy/nginx-apm.sh /docker-entrypoint.d/17-apm.sh
COPY --from=build /repo/apps/platform/dist /usr/share/nginx/html
EXPOSE 8080

# worker 卡住時 compose 才看得出來（容器還在跑不代表 nginx 還在回應）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/_nginx_health || exit 1

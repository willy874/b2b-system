# apps/apm-service：模擬 Sentry API 的前端錯誤收件（docs/architecture/07-apm-service.md）
# esbuild 把程式與依賴打成單一檔案，runtime 映像不需要 node_modules。

# ── build ────────────────────────────────────────────────────────────
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /repo

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
# 根目錄的 prepare 是 lefthook install：映像裡沒有 git，也不需要 git hooks
RUN npm pkg delete scripts.prepare
COPY apps/apm-service/package.json apps/apm-service/
RUN pnpm install --frozen-lockfile --filter @b2b-system/apm-service

COPY apps/apm-service ./apps/apm-service
RUN pnpm --filter @b2b-system/apm-service build

# ── runtime ──────────────────────────────────────────────────────────
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    APM_HOST=0.0.0.0 \
    APM_PORT=9100 \
    APM_DATA_DIR=/data

RUN addgroup -S app && adduser -S app -G app \
 && mkdir -p /data && chown app:app /data

COPY --from=build --chown=app:app /repo/apps/apm-service/dist ./dist

USER app
VOLUME ["/data"]
EXPOSE 9100

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.APM_PORT+'/_health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/main.js"]

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
COPY packages/mail-components/package.json packages/mail-components/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @b2b-system/api...

COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @b2b-system/error-codes build \
 && pnpm --filter @b2b-system/mail-components build \
 && pnpm --filter @b2b-system/realtime build \
 && pnpm --filter @b2b-system/api build
# pnpm 10 的 deploy 預設要求 inject-workspace-packages；--legacy 會把 workspace 依賴（realtime、error-codes、mail-components）實體複製進去。
# mail-components 只帶打包好的 dist/index.cjs：react-email 與它的 CLI 依賴是 devDependencies，不進映像
RUN pnpm --filter @b2b-system/api deploy --prod --legacy /app

# ── runtime ──────────────────────────────────────────────────────────
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
WORKDIR /app
ENV NODE_ENV=production
# argon2、sharp、DNS 查詢共用 libuv 的執行緒池（Node 預設 4）；compose 可依 CPU 數覆寫
ENV UV_THREADPOOL_SIZE=16

RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /repo/apps/api/dist ./dist
COPY --from=build --chown=app:app /repo/apps/api/package.json ./package.json
# migration 的 SQL 由 nest-cli.json 的 assets 在 build 時複製到 dist/src/db/（租戶與平台兩條線；src/db/provision.ts）

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/main.js"]

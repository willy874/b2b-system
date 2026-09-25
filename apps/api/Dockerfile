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
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @game-editor/api...

COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @game-editor/utils build \
 && pnpm --filter @game-editor/realtime build \
 && pnpm --filter @game-editor/api build
# pnpm 10 的 deploy 預設要求 inject-workspace-packages；--legacy 會把 workspace 依賴（realtime）實體複製進去
RUN pnpm --filter @game-editor/api deploy --prod --legacy /app

# ── runtime ──────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /repo/apps/api/dist ./dist
COPY --from=build --chown=app:app /repo/apps/api/package.json ./package.json
# tsconfig 的 rootDir 是 apps/api，產物在 dist/src/；migrate.js 以 __dirname/migrations 找 SQL
COPY --from=build --chown=app:app /repo/apps/api/src/db/migrations ./dist/src/db/migrations

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/main.js"]

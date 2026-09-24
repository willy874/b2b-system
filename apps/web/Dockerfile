# ── build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /repo

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
# 根目錄的 prepare 是 lefthook install：映像裡沒有 git，也不需要 git hooks
RUN npm pkg delete scripts.prepare
COPY packages/utils/package.json packages/utils/
COPY packages/api-sdk/package.json packages/api-sdk/
COPY packages/realtime/package.json packages/realtime/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @game-editor/web...

COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm --filter @game-editor/utils build \
 && pnpm --filter @game-editor/api-sdk build \
 && pnpm --filter @game-editor/realtime build \
 && pnpm --filter @game-editor/web build

# ── runtime ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80

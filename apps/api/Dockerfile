# ── build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /repo

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/utils/package.json packages/utils/
COPY packages/api-sdk/package.json packages/api-sdk/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @game-editor/api... --filter @game-editor/utils

COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @game-editor/utils build && pnpm --filter @game-editor/api build
RUN pnpm deploy --filter @game-editor/api --prod /app

# ── runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /repo/apps/api/dist ./dist
COPY --from=build --chown=app:app /repo/apps/api/package.json ./package.json
COPY --from=build --chown=app:app /repo/apps/api/src/db/migrations ./dist/db/migrations

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]

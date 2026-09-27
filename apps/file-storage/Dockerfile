# apps/file-storage：S3 相容的檔案儲存（docs/architecture/03-file-storage.md §9）
# esbuild 把程式與 zod 打成單一檔案，runtime 映像不需要 node_modules。

# ── build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /repo

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
# 根目錄的 prepare 是 lefthook install：映像裡沒有 git，也不需要 git hooks
RUN npm pkg delete scripts.prepare
COPY apps/file-storage/package.json apps/file-storage/
RUN pnpm install --frozen-lockfile --filter @game-editor/file-storage

COPY apps/file-storage ./apps/file-storage
RUN pnpm --filter @game-editor/file-storage build

# ── runtime ──────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    FILE_STORAGE_HOST=0.0.0.0 \
    FILE_STORAGE_PORT=9000 \
    FILE_STORAGE_DATA_DIR=/data

RUN addgroup -S app && adduser -S app -G app \
 && mkdir -p /data && chown app:app /data

COPY --from=build --chown=app:app /repo/apps/file-storage/dist ./dist

USER app
VOLUME ["/data"]
EXPOSE 9000

# /_health 不需要簽章，也不受 FILE_STORAGE_BASE_PATH 影響
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.FILE_STORAGE_PORT+'/_health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/main.js"]

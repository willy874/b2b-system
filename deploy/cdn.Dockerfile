# 自架 CDN 的邊緣（docs/architecture/backend/09-file.md §16.3）：nginx ＋ njs，設定與 njs 都烤進映像。
#   docker build -f deploy/cdn.Dockerfile -t b2b-system-cdn .
# 非 root（uid 101）、唯讀的根目錄：設定在啟動時產生到 /tmp，快取在 /var/cache/nginx/cdn（掛 volume 或有上限的 emptyDir）。
# 與兩個前端的映像相同的基底（digest 一起更新）；njs 模組已內建在映像裡。
FROM nginxinc/nginx-unprivileged:1.30.5-alpine@sha256:15c994d10d6d78658721c3bcafff14cb281fba2a4bdf9d5ba92c416a472516e3

# 映像內建的 default.conf 用不到（主設定不 include conf.d）；刪掉之後 10-listen-on-ipv6 也不會嘗試改它
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
USER 101

COPY deploy/nginx.cdn.conf /etc/nginx/cdn/nginx.cdn.conf
COPY deploy/cdn.js /etc/nginx/njs/cdn.js
COPY --chmod=755 deploy/nginx-cdn.sh /docker-entrypoint.d/40-cdn.sh

EXPOSE 9080 8081

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null "http://127.0.0.1:${CDN_LISTEN_PORT:-9080}/_nginx_health" || exit 1

CMD ["nginx", "-c", "/tmp/nginx.conf", "-g", "daemon off;"]

#!/usr/bin/env sh
# 驗證兩份前端與對外 API 閘道的 nginx 設定（需要 Docker）：語法（nginx -t），以及實際轉發時的標頭——
# 安全標頭、X-Forwarded-Host 被覆寫、upstream keepalive、不外露版本。以與映像相同的方式掛載設定：
#   deploy/nginx.main.conf → /etc/nginx/nginx.conf
#   deploy/nginx.security-headers.conf → /etc/nginx/snippets/security-headers.conf
#   deploy/nginx.conf／nginx.platform.conf → /etc/nginx/conf.d/default.conf
#
# 用法：sh deploy/check-nginx.sh
set -eu

DEPLOY_DIR=$(cd "$(dirname "$0")" && pwd)
NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine
NODE_IMAGE=node:24-alpine
NETWORK=b2b-nginx-check-$$
PORT=18080

cleanup() {
  docker rm -f "$NETWORK-nginx" "$NETWORK-api" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "✗ $1" >&2
  exit 1
}

# 假的 api：回傳收到的標頭與這條 TCP 連線的編號（keepalive 生效時多個請求共用同一條連線）
ECHO_SERVER='
let next = 0;
require("http").createServer((req, res) => {
  req.socket.id ??= ++next;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ headers: req.headers, connection: req.socket.id }));
}).listen(3000);
'

docker network create "$NETWORK" >/dev/null
docker run -d --name "$NETWORK-api" --network "$NETWORK" --network-alias api \
  "$NODE_IMAGE" node -e "$ECHO_SERVER" >/dev/null

for site in nginx.conf nginx.platform.conf; do
  echo "── $site"
  docker rm -f "$NETWORK-nginx" >/dev/null 2>&1 || true
  docker run -d --name "$NETWORK-nginx" --network "$NETWORK" -p "$PORT:8080" \
    --read-only --tmpfs /tmp --add-host file-storage:127.0.0.1 \
    -v "$DEPLOY_DIR/nginx.main.conf:/etc/nginx/nginx.conf:ro" \
    -v "$DEPLOY_DIR/nginx.security-headers.conf:/etc/nginx/snippets/security-headers.conf:ro" \
    -v "$DEPLOY_DIR/$site:/etc/nginx/conf.d/default.conf:ro" \
    "$NGINX_IMAGE" >/dev/null
  docker exec "$NETWORK-nginx" nginx -t >/dev/null 2>&1 || fail "$site：nginx -t 失敗"

  # 等 nginx 開始接受連線
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/api/health" && break
    sleep 1
  done

  [ "$(docker exec "$NETWORK-nginx" id -u)" != "0" ] || fail "$site：nginx 以 root 執行"

  for path in / /assets/x.js /api/health; do
    headers=$(curl -s -D - -o /dev/null "http://127.0.0.1:$PORT$path")
    for expected in "content-security-policy: .*form-action 'self'" "content-security-policy: .*object-src 'none'" \
      "strict-transport-security: max-age=31536000" "x-frame-options: DENY" "x-content-type-options: nosniff"; do
      echo "$headers" | grep -qi "$expected" || fail "$site $path：缺少 $expected"
    done
    echo "$headers" | grep -qi '^server: nginx/' && fail "$site $path：外露 nginx 版本"
  done

  body=$(curl -s -H 'Host: acme.example.com' -H 'X-Forwarded-Host: beta.example.com' \
    "http://127.0.0.1:$PORT/api/tenant/current")
  echo "$body" | grep -q '"x-forwarded-host":"acme.example.com"' ||
    fail "$site：X-Forwarded-Host 沒有被覆寫成 Host（$body）"

  # 同一條 client 連線（同一個 worker）送兩個請求：upstream 的 keepalive 生效時 api 看到的是同一條 TCP
  connections=$(curl -s "http://127.0.0.1:$PORT/api/a" "http://127.0.0.1:$PORT/api/b" |
    grep -o '"connection":[0-9]*' | sort -u | wc -l | tr -d ' ')
  [ "$connections" = "1" ] || fail "$site：upstream keepalive 沒有生效（用了 $connections 條連線）"

  echo "✓ $site"
done

# ── nginx.external-api.conf：對外 API 的閘道（docs/architecture/06-external-api.md §9.2 D9）。upstream 是 external-api:3001，沒有靜態檔與 /api 前綴
echo "── nginx.external-api.conf"
docker rm -f "$NETWORK-nginx" "$NETWORK-api" >/dev/null 2>&1 || true
docker run -d --name "$NETWORK-api" --network "$NETWORK" --network-alias external-api \
  "$NODE_IMAGE" node -e "$(echo "$ECHO_SERVER" | sed 's/listen(3000)/listen(3001)/')" >/dev/null
docker run -d --name "$NETWORK-nginx" --network "$NETWORK" -p "$PORT:8080" --read-only --tmpfs /tmp \
  -v "$DEPLOY_DIR/nginx.main.conf:/etc/nginx/nginx.conf:ro" \
  -v "$DEPLOY_DIR/nginx.external-api.conf:/etc/nginx/conf.d/default.conf:ro" \
  "$NGINX_IMAGE" >/dev/null
docker exec "$NETWORK-nginx" nginx -t >/dev/null 2>&1 || fail "nginx.external-api.conf：nginx -t 失敗"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/health" && break
  sleep 1
done
headers=$(curl -s -D - -o /dev/null "http://127.0.0.1:$PORT/v1/me")
for expected in "strict-transport-security: max-age=31536000" "x-content-type-options: nosniff" "cache-control: no-store"; do
  echo "$headers" | grep -qi "$expected" || fail "nginx.external-api.conf：缺少 $expected"
done
echo "$headers" | grep -qi '^server: nginx/' && fail "nginx.external-api.conf：外露 nginx 版本"
body=$(curl -s -H 'Authorization: Bearer b2bt_acme_x_y' "http://127.0.0.1:$PORT/v1/me")
echo "$body" | grep -q '"authorization":"Bearer b2bt_acme_x_y"' ||
  fail "nginx.external-api.conf：Authorization 沒有轉給 external-api（$body）"
echo "✓ nginx.external-api.conf"

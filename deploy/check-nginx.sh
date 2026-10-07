#!/usr/bin/env sh
# 驗證兩份前端與對外 API 閘道的 nginx 設定（需要 Docker）：語法（nginx -t），以及實際轉發時的標頭——
# 安全標頭、X-Forwarded-Host 被覆寫、X-Forwarded-For 只採用前置 LB 帶來的值、upstream keepalive、不外露版本、
# 健康檢查端點。以與映像相同的方式掛載設定：
#   deploy/nginx.main.conf → /etc/nginx/nginx.conf
#   deploy/nginx.security-headers.conf → /etc/nginx/snippets/security-headers.conf
#   deploy/nginx.conf／nginx.platform.conf → /etc/nginx/conf.d/default.conf
#   deploy/nginx-real-ip.sh → /docker-entrypoint.d/15-real-ip.sh
#   deploy/nginx-file-origin.sh → /docker-entrypoint.d/16-file-origin.sh（backstage 另帶 FILES_SERVER=1）
#
# 前置 LB 以假的 api 容器扮演：TRUSTED_PROXY_CIDRS 只放它的 IP，主機經 port 連進來的請求就是「不受信任的來源」。
#
# 用法：sh deploy/check-nginx.sh
set -eu

DEPLOY_DIR=$(cd "$(dirname "$0")" && pwd)
# 與 Dockerfile、docker-compose.prod.yml 相同的映像（digest 一起更新）
NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.5-alpine@sha256:15c994d10d6d78658721c3bcafff14cb281fba2a4bdf9d5ba92c416a472516e3
NODE_IMAGE=node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
NETWORK=b2b-nginx-check-$$
PORT=18080
FILE_ORIGIN=https://files.example.test

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

# 從假的 api 容器（扮演前置 LB）對 nginx 送請求，印出回應本體
from_lb() {
  docker exec "$NETWORK-api" node -e \
    "fetch('http://$NETWORK-nginx:8080$1',{headers:{'x-forwarded-for':'$2'}}).then(r=>r.text()).then(console.log)"
}

# X-Forwarded-For：受信任的 LB 帶來的值被採用；其他來源自帶的值被丟掉；api 只收到單一值
check_forwarded_for() {
  site=$1
  path=$2
  body=$(from_lb "$path" 203.0.113.7)
  echo "$body" | grep -q '"x-forwarded-for":"203.0.113.7"' ||
    fail "$site：前置 LB 帶來的 X-Forwarded-For 沒有被採用（$body）"
  body=$(curl -s -H 'X-Forwarded-For: 1.2.3.4' "http://127.0.0.1:$PORT$path")
  echo "$body" | grep -q '1\.2\.3\.4' && fail "$site：不受信任的來源偽造了 X-Forwarded-For（$body）"
  echo "$body" | grep -q '"x-forwarded-for":"[^",]*"' ||
    fail "$site：轉給 api 的 X-Forwarded-For 不是單一值（$body）"
}

# nginx -t、非 root、健康檢查端點只接受容器內的連線
check_container() {
  site=$1
  docker exec "$NETWORK-nginx" nginx -t >/dev/null 2>&1 || fail "$site：nginx -t 失敗"
  [ "$(docker exec "$NETWORK-nginx" id -u)" != "0" ] || fail "$site：nginx 以 root 執行"
  docker exec "$NETWORK-nginx" wget -q -O /dev/null http://127.0.0.1:8080/_nginx_health ||
    fail "$site：容器內的健康檢查失敗"
  status=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/_nginx_health")
  [ "$status" = "403" ] || fail "$site：外部連得到健康檢查端點（$status）"
}

docker network create "$NETWORK" >/dev/null
docker run -d --name "$NETWORK-api" --network "$NETWORK" --network-alias api \
  "$NODE_IMAGE" node -e "$ECHO_SERVER" >/dev/null
LB_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$NETWORK-api")

for site in nginx.conf nginx.platform.conf; do
  echo "── $site"
  docker rm -f "$NETWORK-nginx" >/dev/null 2>&1 || true
  files_server=0
  [ "$site" = "nginx.conf" ] && files_server=1
  docker run -d --name "$NETWORK-nginx" --network "$NETWORK" -p "$PORT:8080" \
    --read-only --tmpfs /tmp --add-host file-storage:127.0.0.1 -e "TRUSTED_PROXY_CIDRS=$LB_IP/32" \
    -e "FILE_DOWNLOAD_ORIGIN=$FILE_ORIGIN" -e "FILES_SERVER=$files_server" \
    -v "$DEPLOY_DIR/nginx.main.conf:/etc/nginx/nginx.conf:ro" \
    -v "$DEPLOY_DIR/nginx.security-headers.conf:/etc/nginx/snippets/security-headers.conf:ro" \
    -v "$DEPLOY_DIR/$site:/etc/nginx/conf.d/default.conf:ro" \
    -v "$DEPLOY_DIR/nginx-real-ip.sh:/docker-entrypoint.d/15-real-ip.sh:ro" \
    -v "$DEPLOY_DIR/nginx-file-origin.sh:/docker-entrypoint.d/16-file-origin.sh:ro" \
    "$NGINX_IMAGE" >/dev/null

  # 等 nginx 開始接受連線
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/api/health" && break
    sleep 1
  done

  check_container "$site"

  for path in / /assets/x.js /api/health; do
    headers=$(curl -s -D - -o /dev/null "http://127.0.0.1:$PORT$path")
    for expected in "content-security-policy: .*form-action 'self'" "content-security-policy: .*object-src 'none'" \
      "strict-transport-security: max-age=31536000" "x-frame-options: DENY" "x-content-type-options: nosniff" \
      "permissions-policy: camera=()" "cross-origin-opener-policy: same-origin" \
      "content-security-policy: .*img-src 'self' data: $FILE_ORIGIN" "content-security-policy: .*connect-src 'self' $FILE_ORIGIN"; do
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

  check_forwarded_for "$site" /api/ip

  # 獨立的檔案網域（docs/architecture/backend/09-file.md §3.2）：只有 backstage 有它的 server
  if [ "$site" = "nginx.conf" ]; then
    files_host=${FILE_ORIGIN#https://}
    headers=$(curl -s -D - -o /dev/null -H "Host: $files_host" "http://127.0.0.1:$PORT/storage/b2b-acme/x")
    for expected in "content-security-policy: .*sandbox" "x-content-type-options: nosniff" \
      "access-control-allow-origin: \\*" "cross-origin-resource-policy: cross-origin"; do
      echo "$headers" | grep -qi "$expected" || fail "檔案網域：缺少 $expected"
    done
    echo "$headers" | grep -qi '^set-cookie:' && fail "檔案網域：回應帶了 Set-Cookie"
    status=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "Host: $files_host" "http://127.0.0.1:$PORT/storage/b2b-acme/x")
    [ "$status" = "405" ] || fail "檔案網域：PUT 沒有回 405（$status）"
    status=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS -H "Host: $files_host" "http://127.0.0.1:$PORT/storage/b2b-acme/x")
    [ "$status" = "204" ] || fail "檔案網域：preflight 沒有回 204（$status）"
    status=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $files_host" "http://127.0.0.1:$PORT/api/health")
    [ "$status" = "404" ] || fail "檔案網域：/api 沒有回 404（$status）"
    echo "✓ 檔案網域"
  fi

  echo "✓ $site"
done

# ── nginx.external-api.conf：對外 API 的閘道（docs/architecture/06-external-api.md §9.2 D9）。upstream 是 external-api:3001，沒有靜態檔與 /api 前綴
echo "── nginx.external-api.conf"
docker rm -f "$NETWORK-nginx" "$NETWORK-api" >/dev/null 2>&1 || true
docker run -d --name "$NETWORK-api" --network "$NETWORK" --network-alias external-api \
  "$NODE_IMAGE" node -e "$(echo "$ECHO_SERVER" | sed 's/listen(3000)/listen(3001)/')" >/dev/null
LB_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$NETWORK-api")
docker run -d --name "$NETWORK-nginx" --network "$NETWORK" -p "$PORT:8080" --read-only --tmpfs /tmp \
  -e "TRUSTED_PROXY_CIDRS=$LB_IP/32" \
  -v "$DEPLOY_DIR/nginx.main.conf:/etc/nginx/nginx.conf:ro" \
  -v "$DEPLOY_DIR/nginx.external-api.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$DEPLOY_DIR/nginx-real-ip.sh:/docker-entrypoint.d/15-real-ip.sh:ro" \
  "$NGINX_IMAGE" >/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/health" && break
  sleep 1
done
check_container nginx.external-api.conf
headers=$(curl -s -D - -o /dev/null "http://127.0.0.1:$PORT/v1/me")
for expected in "strict-transport-security: max-age=31536000" "x-content-type-options: nosniff" "cache-control: no-store"; do
  echo "$headers" | grep -qi "$expected" || fail "nginx.external-api.conf：缺少 $expected"
done
echo "$headers" | grep -qi '^server: nginx/' && fail "nginx.external-api.conf：外露 nginx 版本"
body=$(curl -s -H 'Authorization: Bearer b2bt_acme_x_y' "http://127.0.0.1:$PORT/v1/me")
echo "$body" | grep -q '"authorization":"Bearer b2bt_acme_x_y"' ||
  fail "nginx.external-api.conf：Authorization 沒有轉給 external-api（$body）"
check_forwarded_for nginx.external-api.conf /v1/me
echo "✓ nginx.external-api.conf"

# TRUSTED_PROXY_CIDRS 不是 IP／CIDR 時 nginx 不啟動（不讓值變成任意的 nginx 設定）
echo "── TRUSTED_PROXY_CIDRS 的格式檢查"
docker rm -f "$NETWORK-nginx" >/dev/null 2>&1 || true
docker run --rm --read-only --tmpfs /tmp -e 'TRUSTED_PROXY_CIDRS=10.0.0.0/8;include /etc/passwd' \
  -v "$DEPLOY_DIR/nginx.main.conf:/etc/nginx/nginx.conf:ro" \
  -v "$DEPLOY_DIR/nginx-real-ip.sh:/docker-entrypoint.d/15-real-ip.sh:ro" \
  "$NGINX_IMAGE" nginx -t >/dev/null 2>&1 && fail "不合法的 TRUSTED_PROXY_CIDRS 沒有讓 nginx 啟動失敗"
echo "✓ TRUSTED_PROXY_CIDRS"

# FILE_DOWNLOAD_ORIGIN 不是 origin 時 nginx 不啟動（不讓值變成任意的 nginx 設定）
echo "── FILE_DOWNLOAD_ORIGIN 的格式檢查"
docker run --rm --read-only --tmpfs /tmp -e 'FILE_DOWNLOAD_ORIGIN=https://x.test; include /etc/passwd' \
  -v "$DEPLOY_DIR/nginx.main.conf:/etc/nginx/nginx.conf:ro" \
  -v "$DEPLOY_DIR/nginx-file-origin.sh:/docker-entrypoint.d/16-file-origin.sh:ro" \
  "$NGINX_IMAGE" nginx -t >/dev/null 2>&1 && fail "不合法的 FILE_DOWNLOAD_ORIGIN 沒有讓 nginx 啟動失敗"
echo "✓ FILE_DOWNLOAD_ORIGIN"

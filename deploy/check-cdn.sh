#!/usr/bin/env sh
# 自架 CDN 邊緣的驗證（docs/architecture/backend/09-file.md §16.8；需要 Docker）：以 deploy/cdn.Dockerfile 的映像起兩個邊緣節點、
# 以 apps/file-storage 的映像當源站（開著回源憑證），另起 backstage 的 nginx 設定（對外的 /storage/），逐一確認：
#
#   - 同一個網址兩次：MISS → HIT，源站只被讀一次；不同時間窗的網址也是 HIT（快取的 key 不含簽章）
#   - 竄改路徑、exp、bucket、kid → 403；過期的網址 → 403（即使快取裡有）；以金鑰環的第二把簽的 → 200
#   - PUT／DELETE／POST → 405；/_purge 在對外的埠 → 404；安全標頭、沒有 Set-Cookie
#   - 回源憑證：源站不經憑證不能直接讀；從外面帶 X-Origin-Auth 打租戶網域的 /storage/ 會被清掉
#   - 清理：簽章錯、ts 超過 5 分鐘 → 403；刪除物件 → 清理 → 再讀是 MISS 後的 404（不快取 404）
#   - /_status：每個節點回報 kid（不含金鑰）、快取設定、版本；簽章錯、ts 過舊 → 403；對外的埠沒有這個路徑
#   - X-CDN-Reject：邊緣自己拒絕的請求帶原因（signature／expired／method），源站的回應（200、404）不帶
#   - 兩個節點：清理名稱解析到兩個位址，兩邊的快取檔都被刪掉
#   - 環境變數不合格式時邊緣不啟動
#
# 簽章與清理請求由 deploy/cdn-check.mjs 產生（與 api 相同的格式）。用到主機的 19080～19083；結束時刪掉容器、網路與映像。
#
# 用法：sh deploy/check-cdn.sh
set -eu

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
DEPLOY_DIR="$ROOT_DIR/deploy"
# 與 Dockerfile、docker-compose.prod.yml 相同的映像（digest 一起更新）
NODE_IMAGE=node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.5-alpine@sha256:15c994d10d6d78658721c3bcafff14cb281fba2a4bdf9d5ba92c416a472516e3
PREFIX=b2b-cdn-check-$$
NETWORK=$PREFIX
EDGE_IMAGE=$PREFIX-edge
STORAGE_IMAGE=$PREFIX-file-storage
EDGE_PORT=19080
EDGE2_PORT=19081
WEB_PORT=19082
STORAGE_PORT=19083

# 一次性的金鑰：kid k2 在前（簽發），k1 只驗證（輪替中）
KEY_1=$(openssl rand -base64 48 | tr -d '\n')
KEY_2=$(openssl rand -base64 48 | tr -d '\n')
PURGE_SECRET=$(openssl rand -base64 48 | tr -d '\n')
ORIGIN_SECRET=$(openssl rand -hex 32)
ACCESS_KEY=cdn-check-access
SECRET_KEY=$(openssl rand -hex 24)

cleanup() {
  status=$?
  if [ "$status" != 0 ]; then
    for name in edge1 edge2 storage web; do
      echo "── $name 的日誌" >&2
      docker logs --tail 30 "$PREFIX-$name" >&2 2>&1 || true
    done
  fi
  docker rm -f "$PREFIX-edge1" "$PREFIX-edge2" "$PREFIX-storage" "$PREFIX-web" "$PREFIX-client" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  docker rmi "$EDGE_IMAGE" "$STORAGE_IMAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "✗ $1" >&2
  exit 1
}

# 容器裡的小工具（簽網址、SigV4、清理）
tool() {
  docker exec -e S3_ACCESS_KEY_ID="$ACCESS_KEY" -e S3_SECRET_ACCESS_KEY="$SECRET_KEY" \
    "$PREFIX-client" node /deploy/cdn-check.mjs "$@"
}

# 對外的埠：印出「狀態碼 X-Cache-Status」
fetch_status() {
  curl -s -o /dev/null -D - "$@" | awk 'NR == 1 { code = $2 } tolower($1) == "x-cache-status:" { cache = $2 } END { gsub(/\r/, "", cache); print code, (cache == "" ? "-" : cache) }'
}

# 回應的 X-CDN-Reject（沒有時印 -）
reject_header() {
  curl -s -o /dev/null -D - "$@" | awk 'tolower($1) == "x-cdn-reject:" { value = $2 } END { gsub(/\r/, "", value); print (value == "" ? "-" : value) }'
}

expect_reject() {
  label=$1
  expected=$2
  shift 2
  actual=$(reject_header "$@")
  [ "$actual" = "$expected" ] || fail "$label：X-CDN-Reject 預期 $expected，實際 $actual"
  echo "  ✓ $label（X-CDN-Reject: $actual）"
}

expect_status() {
  label=$1
  expected=$2
  shift 2
  actual=$(fetch_status "$@")
  [ "$actual" = "$expected" ] || fail "$label：預期 $expected，實際 $actual"
  echo "  ✓ $label（$actual）"
}

wait_http() {
  for _ in $(seq 1 30); do
    curl -s -o /dev/null "$1" && return 0
    sleep 1
  done
  fail "等不到 $1"
}

# 源站被讀了幾次（file-storage 的存取紀錄：GetObject ＋ 這個路徑）
origin_reads() {
  docker logs "$PREFIX-storage" 2>/dev/null | grep '"operation":"GetObject"' | grep -c "\"path\":\"$1\"" || true
}

start_edge() {
  name=$1
  port=$2
  docker run -d --name "$PREFIX-$name" --network "$NETWORK" --network-alias cdn-purge -p "127.0.0.1:$port:9080" \
    --read-only --tmpfs /tmp --tmpfs /var/cache/nginx:uid=101,gid=101 \
    -e CDN_SIGNING_KEYS="k2:$KEY_2,k1:$KEY_1" -e CDN_PURGE_SECRET="$PURGE_SECRET" \
    -e CDN_ORIGIN_UPSTREAM=http://file-storage:9000 -e CDN_ORIGIN_SECRET="$ORIGIN_SECRET" \
    -e CDN_CACHE_MAX_SIZE=100m \
    "$EDGE_IMAGE" >/dev/null
}

echo "── 建置映像（邊緣、file-storage）"
docker build -q -f "$DEPLOY_DIR/cdn.Dockerfile" -t "$EDGE_IMAGE" "$ROOT_DIR" >/dev/null
docker build -q -f "$ROOT_DIR/apps/file-storage/Dockerfile" -t "$STORAGE_IMAGE" "$ROOT_DIR" >/dev/null

docker network create "$NETWORK" >/dev/null
docker run -d --name "$PREFIX-storage" --network "$NETWORK" --network-alias file-storage \
  -p "127.0.0.1:$STORAGE_PORT:9000" \
  -e FILE_STORAGE_ACCESS_KEY_ID="$ACCESS_KEY" -e FILE_STORAGE_SECRET_ACCESS_KEY="$SECRET_KEY" \
  -e FILE_STORAGE_BASE_PATH=/storage -e FILE_STORAGE_ORIGIN_SECRET="$ORIGIN_SECRET" \
  "$STORAGE_IMAGE" >/dev/null
docker run -d --name "$PREFIX-client" --network "$NETWORK" -v "$DEPLOY_DIR:/deploy:ro" \
  "$NODE_IMAGE" sleep 600 >/dev/null
start_edge edge1 "$EDGE_PORT"
start_edge edge2 "$EDGE2_PORT"
# backstage 的 nginx（對外的 /storage/ 轉給 file-storage）：檢查外面帶進來的 X-Origin-Auth 被清掉
docker run -d --name "$PREFIX-web" --network "$NETWORK" -p "127.0.0.1:$WEB_PORT:8080" --read-only --tmpfs /tmp \
  -e TRUSTED_PROXY_CIDRS=192.0.2.0/24 -e CDN_PUBLIC_ORIGIN=https://cdn.example.test \
  -v "$DEPLOY_DIR/nginx.main.conf:/etc/nginx/nginx.conf:ro" \
  -v "$DEPLOY_DIR/nginx.security-headers.conf:/etc/nginx/snippets/security-headers.conf:ro" \
  -v "$DEPLOY_DIR/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$DEPLOY_DIR/nginx-upstreams.sh:/docker-entrypoint.d/14-upstreams.sh:ro" \
  -v "$DEPLOY_DIR/nginx-real-ip.sh:/docker-entrypoint.d/15-real-ip.sh:ro" \
  -v "$DEPLOY_DIR/nginx-file-origin.sh:/docker-entrypoint.d/16-file-origin.sh:ro" \
  -v "$DEPLOY_DIR/nginx-apm.sh:/docker-entrypoint.d/17-apm.sh:ro" \
  "$NGINX_IMAGE" >/dev/null

wait_http "http://127.0.0.1:$STORAGE_PORT/_health"
wait_http "http://127.0.0.1:$EDGE_PORT/"
wait_http "http://127.0.0.1:$EDGE2_PORT/"
wait_http "http://127.0.0.1:$WEB_PORT/"

echo "── 容器"
for name in edge1 edge2; do
  docker exec "$PREFIX-$name" nginx -t -c /tmp/nginx.conf >/dev/null 2>&1 || fail "$name：nginx -t 失敗"
  [ "$(docker exec "$PREFIX-$name" id -u)" != "0" ] || fail "$name：nginx 以 root 執行"
  docker exec "$PREFIX-$name" wget -q -O /dev/null http://127.0.0.1:9080/_nginx_health || fail "$name：容器內的健康檢查失敗"
done
expect_status "外部連不到健康檢查端點" "403 -" "http://127.0.0.1:$EDGE_PORT/_nginx_health"

echo "── 準備物件"
for bucket in b2b-acme b2b-other; do
  [ "$(tool s3 PUT "http://file-storage:9000/storage/$bucket")" = 200 ] || fail "建立 bucket $bucket 失敗"
done
KEY_PATH=/storage/b2b-acme/images/a1/r1/sm@2x.webp
ENCODED_PATH=/storage/b2b-acme/images/a1/r1/sm%402x.webp
OTHER_PATH=/storage/b2b-other/images/a1/r1/sm@2x.webp
SECOND_PATH=/storage/b2b-acme/variants/f1/preview.jpeg
for path in "$KEY_PATH" "$OTHER_PATH" "$SECOND_PATH"; do
  [ "$(tool s3 PUT "http://file-storage:9000$path" "content of $path")" = 200 ] || fail "寫入 $path 失敗"
done

NOW=$(date +%s)
EXP=$((NOW + 3600))
EXP_NEXT=$((NOW + 7200))
QUERY=$(tool sign "$KEY_PATH" "$EXP" k2 "$KEY_2")
EDGE="http://127.0.0.1:$EDGE_PORT"

echo "── 命中與簽章"
expect_status "第一次讀取" "200 MISS" "$EDGE$ENCODED_PATH$QUERY"
expect_status "同一個網址再一次" "200 HIT" "$EDGE$ENCODED_PATH$QUERY"
reads=$(origin_reads "$KEY_PATH")
[ "$reads" = "1" ] || fail "源站應該只被讀一次（$reads）"
echo "  ✓ 源站只被讀一次"
expect_status "不同時間窗的網址（快取的 key 不含簽章）" "200 HIT" \
  "$EDGE$ENCODED_PATH$(tool sign "$KEY_PATH" "$EXP_NEXT" k2 "$KEY_2")"
expect_status "金鑰環的第二把（輪替中）" "200 HIT" "$EDGE$ENCODED_PATH$(tool sign "$KEY_PATH" "$EXP" k1 "$KEY_1")"
expect_status "竄改路徑" "403 -" "$EDGE/storage/b2b-acme/images/a1/r1/md.webp$QUERY"
expect_status "竄改 exp" "403 -" "$EDGE$ENCODED_PATH$(echo "$QUERY" | sed "s/exp=$EXP/exp=$EXP_NEXT/")"
expect_status "換 bucket（同一個簽章）" "403 -" "$EDGE/storage/b2b-other/images/a1/r1/sm%402x.webp$QUERY"
expect_status "換 kid" "403 -" "$EDGE$ENCODED_PATH$(echo "$QUERY" | sed 's/kid=k2/kid=k1/')"
expect_status "沒有簽章" "403 -" "$EDGE$ENCODED_PATH"
expect_status "已過期（快取裡有也不送出）" "403 -" "$EDGE$ENCODED_PATH$(tool sign "$KEY_PATH" "$((NOW - 1))" k2 "$KEY_2")"

echo "── X-CDN-Reject（api 的檢查以它區分邊緣的拒絕與源站的回應）"
expect_reject "有效的網址不帶" "-" "$EDGE$ENCODED_PATH$QUERY"
expect_reject "竄改的簽章" "signature" "$EDGE$ENCODED_PATH$(echo "$QUERY" | sed 's/sig=/sig=x/')"
expect_reject "沒有簽章" "signature" "$EDGE$ENCODED_PATH"
expect_reject "已過期" "expired" "$EDGE$ENCODED_PATH$(tool sign "$KEY_PATH" "$((NOW - 1))" k2 "$KEY_2")"
expect_reject "PUT" "method" -X PUT "$EDGE$ENCODED_PATH$QUERY"
MISSING_PATH=/storage/__cdn-check/00000000-0000-4000-8000-000000000000
expect_status "不存在的路徑（簽章正確）：源站的 404" "404 MISS" "$EDGE$MISSING_PATH$(tool sign "$MISSING_PATH" "$EXP" k2 "$KEY_2")"
expect_reject "源站的 404 不帶" "-" "$EDGE$MISSING_PATH$(tool sign "$MISSING_PATH" "$EXP" k2 "$KEY_2")"

echo "── 方法、路徑、標頭"
for method in PUT DELETE POST; do
  expect_status "$method 打對外的埠" "405 -" -X "$method" "$EDGE$ENCODED_PATH$QUERY"
done
expect_status "/_purge 在對外的埠" "404 -" -X POST "$EDGE/_purge"
headers=$(curl -s -D - -o /dev/null "$EDGE$ENCODED_PATH$QUERY")
for expected in "content-security-policy: .*sandbox" "x-content-type-options: nosniff" \
  "cross-origin-resource-policy: cross-origin" "cache-control: public, max-age=[0-9]*, immutable"; do
  echo "$headers" | grep -qi "$expected" || fail "邊緣的回應缺少 $expected"
done
echo "$headers" | grep -qi '^set-cookie:' && fail "邊緣的回應帶了 Set-Cookie"
echo "$headers" | grep -qi '^server: nginx/' && fail "邊緣外露 nginx 版本"
echo "$headers" | grep -qi '^x-amz-' && fail "邊緣外露源站的 x-amz-* 標頭"
echo "  ✓ 安全標頭、Cache-Control 依網址的剩餘效期、沒有 Set-Cookie"

echo "── 回源憑證"
expect_status "直接讀源站（沒有憑證）" "403 -" "http://127.0.0.1:$STORAGE_PORT$ENCODED_PATH"
expect_status "直接讀源站（帶憑證，內部網路的邊緣才會這樣做）" "200 -" \
  -H "X-Origin-Auth: $ORIGIN_SECRET" "http://127.0.0.1:$STORAGE_PORT$ENCODED_PATH"
expect_status "從外面帶 X-Origin-Auth 打租戶網域的 /storage/（被清掉，照舊要 SigV4）" "403 -" \
  -H "X-Origin-Auth: $ORIGIN_SECRET" "http://127.0.0.1:$WEB_PORT$ENCODED_PATH"
expect_status "源站不接受回源憑證以外的參數改寫（response-content-type）" "403 -" \
  -H "X-Origin-Auth: $ORIGIN_SECRET" "http://127.0.0.1:$STORAGE_PORT$ENCODED_PATH?response-content-type=text/html"
curl -s -D - -o /dev/null "http://127.0.0.1:$WEB_PORT/" | grep -qi "content-security-policy: .*img-src 'self' data:  https://cdn.example.test" ||
  fail "backstage 的 CSP 沒有放行 CDN_PUBLIC_ORIGIN"
echo "  ✓ backstage 的 CSP img-src 放行 CDN_PUBLIC_ORIGIN"

echo "── 清理"
result=$(tool purge http://cdn-purge:8081 "$PURGE_SECRET" "$KEY_PATH" 0 bad)
echo "$result" | grep -qv ' 403 ' && fail "簽章錯誤的清理沒有回 403（$result）"
result=$(tool purge http://cdn-purge:8081 "$PURGE_SECRET" "$KEY_PATH" -400)
echo "$result" | grep -qv ' 403 ' && fail "ts 超過 5 分鐘的清理沒有回 403（$result）"
echo "  ✓ 簽章錯、ts 過舊 → 403"
[ "$(tool s3 DELETE "http://file-storage:9000$KEY_PATH")" = 204 ] || fail "刪除物件失敗"
expect_status "刪除物件後、清理前：快取還在" "200 HIT" "$EDGE$ENCODED_PATH$QUERY"
result=$(tool purge http://cdn-purge:8081 "$PURGE_SECRET" "$KEY_PATH")
nodes=$(echo "$result" | grep -c ' 200 ')
[ "$nodes" = "2" ] || fail "清理應該送到兩個節點（$result）"
echo "$result" | grep -q '"purged":1' || fail "沒有節點刪掉快取檔（$result）"
expect_status "清理後：回源拿到 404" "404 MISS" "$EDGE$ENCODED_PATH$QUERY"
expect_status "404 不快取" "404 MISS" "$EDGE$ENCODED_PATH$QUERY"

echo "── /_status"
result=$(tool status http://cdn-purge:8081 "$PURGE_SECRET")
[ "$(echo "$result" | grep -c ' 200 ')" = "2" ] || fail "/_status 應該兩個節點都回 200（$result）"
echo "$result" | grep -q '"kids":\["k2","k1"\]' || fail "/_status 沒有依金鑰環的順序回報 kid（$result）"
echo "$result" | grep -q '"maxSize":"100m"' || fail "/_status 沒有回報快取設定（$result）"
echo "$result" | grep -q '"build":"dev"' || fail "/_status 沒有回報映像版本（$result）"
echo "$result" | grep -Eq '"startedAt":"[0-9]{4}-[0-9]{2}-[0-9]{2}T' || fail "/_status 沒有回報啟動時間（$result）"
echo "$result" | grep -q "$KEY_2" && fail "/_status 洩漏了金鑰"
echo "  ✓ 兩個節點都回報 kid（依金鑰環的順序、不含金鑰）、快取設定、版本與啟動時間"
result=$(tool status http://cdn-purge:8081 "$PURGE_SECRET" 0 bad)
[ "$(echo "$result" | grep -c ' 403 ')" = "2" ] || fail "簽章錯誤的 /_status 沒有回 403（$result）"
result=$(tool status http://cdn-purge:8081 "$PURGE_SECRET" -400)
[ "$(echo "$result" | grep -c ' 403 ')" = "2" ] || fail "ts 超過 5 分鐘的 /_status 沒有回 403（$result）"
echo "  ✓ /_status 簽章錯、ts 過舊 → 403"
expect_status "/_status 在對外的埠" "404 -" "$EDGE/_status"

echo "── 兩個節點"
SECOND_ENCODED=$SECOND_PATH
SECOND_QUERY=$(tool sign "$SECOND_PATH" "$EXP" k2 "$KEY_2")
for port in "$EDGE_PORT" "$EDGE2_PORT"; do
  expect_status "節點 :$port 第一次" "200 MISS" "http://127.0.0.1:$port$SECOND_ENCODED$SECOND_QUERY"
  expect_status "節點 :$port 第二次" "200 HIT" "http://127.0.0.1:$port$SECOND_ENCODED$SECOND_QUERY"
done
cache_file=$(docker exec "$PREFIX-client" node -e "
const m=require('crypto').createHash('md5').update(process.argv[1]).digest('hex');
console.log('/var/cache/nginx/cdn/'+m.slice(-1)+'/'+m.slice(-3,-1)+'/'+m)" "$SECOND_PATH")
for name in edge1 edge2; do
  docker exec "$PREFIX-$name" test -f "$cache_file" || fail "$name 沒有快取檔 $cache_file"
done
result=$(tool purge http://cdn-purge:8081 "$PURGE_SECRET" "$SECOND_PATH")
[ "$(echo "$result" | grep -c '"purged":1')" = "2" ] || fail "兩個節點都應該刪掉快取檔（$result）"
for name in edge1 edge2; do
  docker exec "$PREFIX-$name" test -f "$cache_file" && fail "$name 的快取檔沒有被刪掉"
done
echo "  ✓ 清理送到兩個節點，兩邊的快取檔都被刪掉"
expect_status "物件還在：清理後重新回源" "200 MISS" "$EDGE$SECOND_ENCODED$SECOND_QUERY"
result=$(tool purge http://cdn-purge:8081 "$PURGE_SECRET" all)
[ "$(echo "$result" | grep -c ' 200 ')" = "2" ] || fail "清空整個快取失敗（$result）"
expect_status "清空整個快取之後" "200 MISS" "$EDGE$SECOND_ENCODED$SECOND_QUERY"

echo "── 環境變數的格式檢查"
for bad in 'CDN_SIGNING_KEYS=k1:short' 'CDN_PURGE_SECRET=' 'CDN_ORIGIN_UPSTREAM=http://x;include /etc/passwd' \
  'CDN_CACHE_MAX_SIZE=10g; include /etc/passwd' 'CDN_PURGE_PORT=9080' "CDN_BUILD=x'; include /etc/passwd"; do
  docker run --rm --read-only --tmpfs /tmp \
    -e CDN_SIGNING_KEYS="k2:$KEY_2" -e CDN_PURGE_SECRET="$PURGE_SECRET" -e "$bad" \
    "$EDGE_IMAGE" nginx -t -c /tmp/nginx.conf >/dev/null 2>&1 && fail "不合法的 $bad 沒有讓邊緣啟動失敗"
done
echo "  ✓ 不合法的值讓邊緣啟動失敗"

echo "✓ deploy/check-cdn.sh"

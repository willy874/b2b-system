#!/bin/sh
# 自架 CDN 邊緣的啟動前檢查（docs/architecture/backend/09-file.md §16.3）：檢查 CDN_* 環境變數，
# 以 envsubst 把 deploy/nginx.cdn.conf 套成 /tmp/nginx.conf（映像以 nginx -c /tmp/nginx.conf 啟動；根目錄唯讀）。
# 值不合格式就不啟動：不讓環境變數變成任意的 nginx 設定。映像裡是 /docker-entrypoint.d/40-cdn.sh。
#
#   CDN_SIGNING_KEYS     必填：與 api 的 FILE_CDN_SIGNING_KEYS 相同（<kid>:<base64>[,…]）
#   CDN_PURGE_SECRET     必填：與 api 的 FILE_CDN_PURGE_SECRET 相同（base64）
#   CDN_ORIGIN_UPSTREAM  回源的位址（預設 http://file-storage:9000；本機是 http://host.docker.internal:9000）
#   CDN_ORIGIN_SECRET    選填：與 file-storage 的 FILE_STORAGE_ORIGIN_SECRET 相同；沒設定就不帶回源憑證
#   CDN_ORIGIN_PATH_PREFIX 源站的路徑前綴（預設 /storage，同 FILE_STORAGE_BASE_PATH）；直接回源到 S3 的 path-style 端點時設成空字串
#   CDN_ORIGIN_CA_FILE   https 回源時驗證源站憑證用的 CA（預設映像內建的公開 CA；內部 CA 掛進容器後指到它）
#   CDN_CACHE_MAX_SIZE（10g）、CDN_CACHE_INACTIVE（30d）、CDN_CACHE_VALID（30d）、CDN_LISTEN_PORT（9080）、CDN_PURGE_PORT（8081）
#   CDN_BUILD            映像的版本（建置時的 build arg；/_status 回報）
set -eu

fail() {
  echo "nginx-cdn: $1" >&2
  exit 1
}

TEMPLATE=${CDN_TEMPLATE:-/etc/nginx/cdn/nginx.cdn.conf}
OUTPUT=${CDN_OUTPUT:-/tmp/nginx.conf}

keys="${CDN_SIGNING_KEYS:-}"
[ -n "$keys" ] || fail "CDN_SIGNING_KEYS 未設定（與 api 的 FILE_CDN_SIGNING_KEYS 相同）"
echo "$keys" | grep -Eq '^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9+/]{43,}={0,2}(,[A-Za-z0-9_-]{1,32}:[A-Za-z0-9+/]{43,}={0,2})*$' ||
  fail "CDN_SIGNING_KEYS 的格式是 <kid>:<base64，至少 32 bytes>[,…]"

secret="${CDN_PURGE_SECRET:-}"
echo "$secret" | grep -Eq '^[A-Za-z0-9+/]{43,}={0,2}$' ||
  fail "CDN_PURGE_SECRET 未設定或不是至少 32 bytes 的 base64（與 api 的 FILE_CDN_PURGE_SECRET 相同）"

origin_secret="${CDN_ORIGIN_SECRET:-}"
if [ -n "$origin_secret" ]; then
  # busybox 的 grep 不接受超過 255 的重複次數：長度另外檢查
  { [ ${#origin_secret} -ge 32 ] && [ ${#origin_secret} -le 256 ] && echo "$origin_secret" | grep -Eq '^[A-Za-z0-9+/=_-]+$'; } ||
    fail "CDN_ORIGIN_SECRET 只能是 32～256 個英數與 +/=_- 字元（與 file-storage 的 FILE_STORAGE_ORIGIN_SECRET 相同）"
fi

upstream="${CDN_ORIGIN_UPSTREAM:-http://file-storage:9000}"
case "$upstream" in
  http://* | https://*) ;;
  *) fail "CDN_ORIGIN_UPSTREAM 要以 http:// 或 https:// 開頭：$upstream" ;;
esac
CDN_ORIGIN_SCHEME=${upstream%%://*}
CDN_ORIGIN_HOSTPORT=${upstream#*://}
echo "$CDN_ORIGIN_HOSTPORT" | grep -Eq '^[A-Za-z0-9.-]+(:[0-9]{1,5})?$' ||
  fail "CDN_ORIGIN_UPSTREAM 只能是 <協定>://<主機>[:埠]（不帶路徑）：$upstream"
CDN_ORIGIN_HOSTNAME=${CDN_ORIGIN_HOSTPORT%%:*}
# 回源的 Host：沒寫埠時不帶預設埠（S3 等以 Host 判斷端點的源站比對的是不含 :443 的名稱）
CDN_ORIGIN_HOST=$CDN_ORIGIN_HOSTPORT
case "$CDN_ORIGIN_HOSTPORT" in
  *:*) ;;
  *)
    if [ "$CDN_ORIGIN_SCHEME" = "https" ]; then
      CDN_ORIGIN_HOSTPORT="$CDN_ORIGIN_HOSTPORT:443"
    else
      CDN_ORIGIN_HOSTPORT="$CDN_ORIGIN_HOSTPORT:80"
    fi
    ;;
esac

# 源站的路徑前綴：邊緣收到的是 /storage/<bucket>/<key>，回源時換成 <前綴>/<bucket>/<key>。
# 沒設定是 /storage（apps/file-storage）；設成空字串是 /<bucket>/<key>（S3 的 path-style）。快取的 key 與清理的路徑不受影響
CDN_ORIGIN_PATH_PREFIX=${CDN_ORIGIN_PATH_PREFIX-/storage}
case "$CDN_ORIGIN_PATH_PREFIX" in
  '') ;;
  *)
    echo "$CDN_ORIGIN_PATH_PREFIX" | grep -Eq '^(/[A-Za-z0-9._-]+)+$' ||
      fail "CDN_ORIGIN_PATH_PREFIX 只能是空字串或 /<段>[/<段>…]（英數與 ._-，結尾不帶 /）：$CDN_ORIGIN_PATH_PREFIX"
    ;;
esac

# https 回源一律驗證源站的憑證（不驗證時，網路上的任何人都能把內容塞進所有人共用的快取）
CDN_ORIGIN_CA_FILE=${CDN_ORIGIN_CA_FILE:-/etc/ssl/certs/ca-certificates.crt}
echo "$CDN_ORIGIN_CA_FILE" | grep -Eq '^/[A-Za-z0-9._/-]+$' || fail "CDN_ORIGIN_CA_FILE 要是絕對路徑：$CDN_ORIGIN_CA_FILE"
[ -r "$CDN_ORIGIN_CA_FILE" ] || fail "CDN_ORIGIN_CA_FILE 讀不到：$CDN_ORIGIN_CA_FILE"

CDN_CACHE_MAX_SIZE=${CDN_CACHE_MAX_SIZE:-10g}
CDN_CACHE_INACTIVE=${CDN_CACHE_INACTIVE:-30d}
CDN_CACHE_VALID=${CDN_CACHE_VALID:-30d}
CDN_LISTEN_PORT=${CDN_LISTEN_PORT:-9080}
CDN_PURGE_PORT=${CDN_PURGE_PORT:-8081}
echo "$CDN_CACHE_MAX_SIZE" | grep -Eq '^[0-9]+[kKmMgG]?$' || fail "CDN_CACHE_MAX_SIZE 的格式是 <數字>[k|m|g]：$CDN_CACHE_MAX_SIZE"
for value in "$CDN_CACHE_INACTIVE" "$CDN_CACHE_VALID"; do
  echo "$value" | grep -Eq '^[0-9]+(ms|s|m|h|d|w|M|y)?$' || fail "CDN_CACHE_INACTIVE／CDN_CACHE_VALID 的格式是 <數字>[s|m|h|d]：$value"
done
for value in "$CDN_LISTEN_PORT" "$CDN_PURGE_PORT"; do
  echo "$value" | grep -Eq '^[0-9]{4,5}$' || fail "CDN_LISTEN_PORT／CDN_PURGE_PORT 要是 1024 以上的埠（非 root 的 nginx）：$value"
done
[ "$CDN_LISTEN_PORT" != "$CDN_PURGE_PORT" ] || fail "CDN_LISTEN_PORT 與 CDN_PURGE_PORT 不能相同：清理端點不能出現在對外的埠"

# /_status 回報的映像版本（映像建置時的 CDN_BUILD）與啟動時間
CDN_BUILD=${CDN_BUILD:-dev}
echo "$CDN_BUILD" | grep -Eq '^[A-Za-z0-9._+-]{1,64}$' || fail "CDN_BUILD 只能是 1～64 個英數與 ._+- 字元：$CDN_BUILD"
CDN_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 名稱伺服器取自容器的 /etc/resolv.conf（docker 是 127.0.0.11）；nginx 的 resolver 不套 search domain
nameserver=$(awk '$1 == "nameserver" { print $2; exit }' /etc/resolv.conf 2>/dev/null || true)
case "$nameserver" in
  '') nameserver=127.0.0.11 ;;
  *:*) nameserver="[$nameserver]" ;;
esac
CDN_RESOLVER=$nameserver

export CDN_CACHE_MAX_SIZE CDN_CACHE_INACTIVE CDN_CACHE_VALID CDN_LISTEN_PORT CDN_PURGE_PORT
export CDN_ORIGIN_SCHEME CDN_ORIGIN_HOSTPORT CDN_ORIGIN_HOSTNAME CDN_ORIGIN_HOST CDN_ORIGIN_PATH_PREFIX CDN_ORIGIN_CA_FILE
export CDN_RESOLVER CDN_BUILD CDN_STARTED_AT
envsubst '${CDN_CACHE_MAX_SIZE} ${CDN_CACHE_INACTIVE} ${CDN_CACHE_VALID} ${CDN_LISTEN_PORT} ${CDN_PURGE_PORT} ${CDN_ORIGIN_SCHEME} ${CDN_ORIGIN_HOSTPORT} ${CDN_ORIGIN_HOSTNAME} ${CDN_ORIGIN_HOST} ${CDN_ORIGIN_PATH_PREFIX} ${CDN_ORIGIN_CA_FILE} ${CDN_RESOLVER} ${CDN_BUILD} ${CDN_STARTED_AT}' \
  <"$TEMPLATE" >"$OUTPUT"

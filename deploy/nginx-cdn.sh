#!/bin/sh
# 自架 CDN 邊緣的啟動前檢查（docs/architecture/backend/09-file.md §16.3）：檢查 CDN_* 環境變數，
# 以 envsubst 把 deploy/nginx.cdn.conf 套成 /tmp/nginx.conf（映像以 nginx -c /tmp/nginx.conf 啟動；根目錄唯讀）。
# 值不合格式就不啟動：不讓環境變數變成任意的 nginx 設定。映像裡是 /docker-entrypoint.d/40-cdn.sh。
#
#   CDN_SIGNING_KEYS     必填：與 api 的 FILE_CDN_SIGNING_KEYS 相同（<kid>:<base64>[,…]）
#   CDN_PURGE_SECRET     必填：與 api 的 FILE_CDN_PURGE_SECRET 相同（base64）
#   CDN_ORIGIN_UPSTREAM  回源的位址（預設 http://file-storage:9000；本機是 http://host.docker.internal:9000）
#   CDN_ORIGIN_SECRET    選填：與 file-storage 的 FILE_STORAGE_ORIGIN_SECRET 相同；沒設定就不帶回源憑證
#   CDN_CACHE_MAX_SIZE（10g）、CDN_CACHE_INACTIVE（30d）、CDN_CACHE_VALID（30d）、CDN_LISTEN_PORT（9080）、CDN_PURGE_PORT（8081）
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

# 名稱伺服器取自容器的 /etc/resolv.conf（docker 是 127.0.0.11）；nginx 的 resolver 不套 search domain
nameserver=$(awk '$1 == "nameserver" { print $2; exit }' /etc/resolv.conf 2>/dev/null || true)
case "$nameserver" in
  '') nameserver=127.0.0.11 ;;
  *:*) nameserver="[$nameserver]" ;;
esac
CDN_RESOLVER=$nameserver

export CDN_CACHE_MAX_SIZE CDN_CACHE_INACTIVE CDN_CACHE_VALID CDN_LISTEN_PORT CDN_PURGE_PORT
export CDN_ORIGIN_SCHEME CDN_ORIGIN_HOSTPORT CDN_ORIGIN_HOSTNAME CDN_RESOLVER
envsubst '${CDN_CACHE_MAX_SIZE} ${CDN_CACHE_INACTIVE} ${CDN_CACHE_VALID} ${CDN_LISTEN_PORT} ${CDN_PURGE_PORT} ${CDN_ORIGIN_SCHEME} ${CDN_ORIGIN_HOSTPORT} ${CDN_ORIGIN_HOSTNAME} ${CDN_RESOLVER}' \
  <"$TEMPLATE" >"$OUTPUT"

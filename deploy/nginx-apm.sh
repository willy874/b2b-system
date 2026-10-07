#!/bin/sh
# APM 整套的開關（docs/architecture/07-apm-service.md §8.1）→ /tmp/nginx-apm.conf，由 deploy/nginx.main.conf 在 http 層 include：
#
# - 變數 $apm_enabled：deploy/nginx.conf、nginx.platform.conf 的 /apm/ 收件端點在它不是 true 時回 404，不轉給 apm-service。
# - resolver：/apm/ 以變數 proxy_pass，apm-service 的名稱在請求時才解析。APM 關閉（compose 的 apm profile 沒啟用）時
#   apm-service 不存在，nginx 照樣起得來；開啟卻沒有 apm-service 時收件回 502，其他路徑不受影響。
#   名稱伺服器取自容器的 /etc/resolv.conf（docker 是 127.0.0.11）。
#
# 兩個前端的映像都有這支腳本（/docker-entrypoint.d/17-apm.sh）。APM_ENABLED：true（預設）／false。
set -eu

enabled="${APM_ENABLED:-true}"
case "$enabled" in
  true | false) ;;
  *)
    echo "APM_ENABLED 只能是 true 或 false：$enabled" >&2
    exit 1
    ;;
esac

nameserver=$(awk '$1 == "nameserver" { print $2; exit }' /etc/resolv.conf 2>/dev/null || true)
case "$nameserver" in
  '') nameserver=127.0.0.11 ;;
  *:*) nameserver="[$nameserver]" ;;
esac

{
  printf 'map "" $apm_enabled {\n  default "%s";\n}\n' "$enabled"
  printf 'resolver %s valid=30s ipv6=off;\n' "$nameserver"
} >/tmp/nginx-apm.conf

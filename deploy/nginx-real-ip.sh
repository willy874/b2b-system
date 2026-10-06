#!/bin/sh
# 前置 LB 的來源網段 → nginx 的 real_ip 設定（docs/architecture/01-system.md §4.2「客戶端 IP」）。
# 映像的 entrypoint 在啟動 nginx 之前執行 /docker-entrypoint.d/ 裡的腳本：前端映像在建置時複製進去，
# external-gateway 以 volume 掛載。
#
# 只有從 TRUSTED_PROXY_CIDRS（逗號或空白分隔）連進來的請求，才採用它帶來的 X-Forwarded-For；
# 其他來源自帶的標頭一律忽略。之後各 location 把 X-Forwarded-For 覆寫成這裡算出的單一 IP，api 只信任 nginx 這一跳。
# 留空 = 前面沒有代理（$remote_addr 就是客戶端）。
#
# 根目錄是唯讀的，產生的設定寫在 /tmp（tmpfs），由 deploy/nginx.main.conf include。
set -eu

out=/tmp/nginx-real-ip.conf
: >"$out"
for cidr in $(echo "${TRUSTED_PROXY_CIDRS:-}" | tr ',' ' '); do
  case "$cidr" in
    *[!0-9A-Fa-f.:/]*)
      echo "TRUSTED_PROXY_CIDRS 有不是 IP 或 CIDR 的值：$cidr" >&2
      exit 1
      ;;
  esac
  echo "set_real_ip_from $cidr;" >>"$out"
done
if [ -s "$out" ]; then
  # recursive：LB 之前若還有一層也在信任清單裡的代理，一路往左找到第一個不受信任的位址
  printf 'real_ip_header X-Forwarded-For;\nreal_ip_recursive on;\n' >>"$out"
fi

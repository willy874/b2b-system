#!/bin/sh
# api 的 upstream（docs/features/multi-instance.md D12）→ /tmp/nginx-upstreams.conf，由 deploy/nginx.main.conf 在 http 層 include：
#
# - api_backend：REST（API_UPSTREAM，預設 api:3000）。
# - realtime_backend：/api/socket.io/（REALTIME_UPSTREAM，預設同 API_UPSTREAM）。拆開部署時指向 realtime 角色的服務。
#
# `server … resolve`：名稱在執行期重新解析（nginx 1.27.3 起開源版支援），多實例時 docker 的 DNS 回傳每個實例的位址、
# 擴縮之後也跟得上；名稱暫時解析不到時 nginx 照樣起得來，請求回 502。名稱伺服器取自容器的 /etc/resolv.conf
# （docker 是 127.0.0.11）。nginx 的 resolver 不套 search domain：k8s 要寫完整的服務名稱（api.<namespace>.svc.cluster.local:3000）。
#
# 兩個前端的映像都有這支腳本（/docker-entrypoint.d/14-upstreams.sh）。API_UPSTREAM_KEEPALIVE：對 api 保留的閒置連線數。
set -eu

api="${API_UPSTREAM:-api:3000}"
realtime="${REALTIME_UPSTREAM:-$api}"
keepalive="${API_UPSTREAM_KEEPALIVE:-64}"

for value in "$api" "$realtime"; do
  case "$value" in
    *[!A-Za-z0-9.:-]* | '')
      echo "API_UPSTREAM／REALTIME_UPSTREAM 只能是 <主機>:<port>：$value" >&2
      exit 1
      ;;
  esac
done

nameserver=$(awk '$1 == "nameserver" { print $2; exit }' /etc/resolv.conf 2>/dev/null || true)
case "$nameserver" in
  '') nameserver=127.0.0.11 ;;
  *:*) nameserver="[$nameserver]" ;;
esac

cat >/tmp/nginx-upstreams.conf <<CONF
upstream api_backend {
  zone api_backend 64k;
  resolver $nameserver valid=10s ipv6=off;
  server $api resolve;
  keepalive $keepalive;
  keepalive_timeout 60s;
}

upstream realtime_backend {
  zone realtime_backend 64k;
  resolver $nameserver valid=10s ipv6=off;
  server $realtime resolve;
}
CONF

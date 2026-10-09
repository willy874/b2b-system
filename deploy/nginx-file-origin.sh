#!/bin/sh
# 獨立的檔案網域（docs/architecture/backend/09-file.md §3.2）與圖片的 CDN（§16）→ 兩份產生的設定，寫在 /tmp（根目錄唯讀），
# 由 deploy/nginx.main.conf include：
#
# - /tmp/nginx-file-origin.conf：變數 $file_origin、$cdn_origin，安全標頭的 CSP 以它們放行檔案網域（img-src、media-src、connect-src）
#   與 CDN（img-src）。兩個前端的映像都有這支腳本；沒設定時是空字串（CSP 與沒有它們時相同）。
# - /tmp/nginx-files-server.conf：檔案網域的 server（只在 backstage 的映像產生，傳入 FILES_SERVER=1）。
#   只開 /storage/ 的 GET／HEAD（preflight 回 204），其他方法 405、其他路徑 404；不轉給 api、不送 cookie。
#
# FILE_DOWNLOAD_ORIGIN：https://files.example.com；CDN_PUBLIC_ORIGIN：https://cdn.example.com（api 的 FILE_CDN_ORIGIN）。
# 兩者都只能是 origin（協定、主機、選填的埠）。
set -eu

# 檢查 $2 是 origin（空字串也可以）；不是就以 $1 的名稱報錯並結束
check_origin() {
  case "$2" in
    '') ;;
    http://* | https://*)
      rest=${2#*://}
      case "$rest" in
        '' | *[!A-Za-z0-9.:-]*)
          echo "$1 只能是 origin（例：https://files.example.com）：$2" >&2
          exit 1
          ;;
      esac
      ;;
    *)
      echo "$1 要以 http:// 或 https:// 開頭：$2" >&2
      exit 1
      ;;
  esac
}

origin="${FILE_DOWNLOAD_ORIGIN:-}"
cdn_origin="${CDN_PUBLIC_ORIGIN:-}"
check_origin FILE_DOWNLOAD_ORIGIN "$origin"
check_origin CDN_PUBLIC_ORIGIN "$cdn_origin"
host=${origin#*://}

printf 'map "" $file_origin {\n  default "%s";\n}\nmap "" $cdn_origin {\n  default "%s";\n}\n' "$origin" "$cdn_origin" >/tmp/nginx-file-origin.conf

out=/tmp/nginx-files-server.conf
: >"$out"
if [ -n "$origin" ] && [ "${FILES_SERVER:-}" = "1" ]; then
  server_name=${host%%:*}
  cat >"$out" <<CONF
# 由 deploy/nginx-file-origin.sh 產生：檔案網域（$origin）
server {
  listen 8080;
  server_name $server_name;

  location /storage/ {
    if (\$request_method = OPTIONS) {
      add_header Access-Control-Allow-Origin "*" always;
      add_header Access-Control-Allow-Methods "GET, HEAD" always;
      add_header Access-Control-Allow-Headers "Range" always;
      add_header Access-Control-Max-Age "86400" always;
      return 204;
    }
    if (\$request_method !~ ^(GET|HEAD)\$) {
      return 405;
    }
    proxy_pass http://file-storage:9000;
    proxy_http_version 1.1;
    proxy_set_header Host \$http_host;
    proxy_set_header Cookie "";
    proxy_set_header Authorization "";
    # CDN 的回源憑證只屬於內部的 cdn 容器那一跳：外面帶進來的一律清掉（docs/architecture/03-file-storage.md §3.3）
    proxy_set_header X-Origin-Auth "";
    proxy_buffering off;
    proxy_read_timeout 300s;
    proxy_hide_header Set-Cookie;
    proxy_hide_header Content-Security-Policy;
    proxy_hide_header X-Content-Type-Options;
    proxy_hide_header Access-Control-Allow-Origin;
    add_header Content-Security-Policy "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Cross-Origin-Resource-Policy "cross-origin" always;
    add_header Access-Control-Allow-Origin "*" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header Referrer-Policy "no-referrer" always;
  }

  location / {
    return 404;
  }
}
CONF
fi

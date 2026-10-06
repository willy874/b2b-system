#!/usr/bin/env sh
# 正式環境的備份（docs/architecture/01-system.md §4.5）：在部署目錄執行，輸出到 <輸出目錄>/<UTC 時間>/。
#
#   globals.sql      DB 角色（含密碼雜湊）。租戶 DB 角色的密碼只存在加密的連線字串裡，還原時角色要一起回來
#   <database>.dump  平台 DB 與每個租戶的 database 各一份（pg_dump -Fc）：每個租戶可以單獨還原
#   files.tar.gz     file-storage 的 volume。在 DB 之後才打包：多出來、沒有紀錄的物件由檔案維護排程清掉
#                    （backend/09-file.md §9 #3）；反過來的話 DB 會指向不存在的物件
#
# 不含主金鑰（TENANT_SECRET_KEY 等）：金鑰另外保存在秘密管理服務，與資料備份分開。輸出目錄要再複製到主機以外。
#
# 用法：sh deploy/backup.sh <輸出目錄>
# 環境變數 COMPOSE：預設 docker compose --env-file deploy/prod.env -f docker-compose.prod.yml
set -eu

out=${1:?用法：sh deploy/backup.sh <輸出目錄>}
COMPOSE=${COMPOSE:-docker compose --env-file deploy/prod.env -f docker-compose.prod.yml}
dir="$out/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$dir"

# 在 postgres 容器裡以超級使用者執行（POSTGRES_USER 是容器的環境變數）
in_postgres() {
  $COMPOSE exec -T postgres sh -c "$1" sh "${2:-}"
}

echo "── DB 角色"
in_postgres 'pg_dumpall -U "$POSTGRES_USER" --globals-only' >"$dir/globals.sql"

databases=$(in_postgres 'psql -U "$POSTGRES_USER" -d postgres -Atc "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY 1"' |
  grep -vx postgres)
for db in $databases; do
  echo "── $db"
  in_postgres 'pg_dump -U "$POSTGRES_USER" -Fc "$1"' "$db" >"$dir/$db.dump"
done

echo "── file-storage"
$COMPOSE exec -T file-storage tar -czf - -C /data . >"$dir/files.tar.gz"

echo "✓ $dir"

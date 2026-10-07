-- 既有部署啟用監控時建立 postgres-exporter 的角色（新部署由 deploy/postgres/10-roles.sh 在初始化時建立）。
-- 以超級使用者執行一次，密碼與 deploy/prod.env 的 POSTGRES_MONITOR_PASSWORD 相同：
--   docker compose --env-file deploy/prod.env -f docker-compose.prod.yml exec -T postgres \
--     psql -U "$POSTGRES_USER" -d postgres -v monitor_password="$POSTGRES_MONITOR_PASSWORD" < deploy/monitoring/create-monitor-role.sql
-- pg_monitor 只能讀統計（pg_stat_*、pg_settings），讀不到任何業務資料（docs/architecture/08-monitoring.md §6.1）。
CREATE ROLE b2b_monitor LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'monitor_password';
GRANT pg_monitor TO b2b_monitor;
-- pg_stat_statements 的 view 只在建立了 extension 的 database 看得到；10-roles.sh 建在 postgres database
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

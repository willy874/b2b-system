#!/bin/sh
# postgres 映像第一次初始化資料目錄時執行（/docker-entrypoint-initdb.d/）：建立非超級使用者的 DB 角色，
# api 與 migrate 都不再用 POSTGRES_USER（超級使用者）連線（docs/architecture/05-tenancy.md §7.1）。
#
# | 角色                  | 權限                                         | 誰用                                         |
# | --------------------- | -------------------------------------------- | -------------------------------------------- |
# | b2b_platform          | 擁有平台 DB（含 pg-boss 的 schema）           | api、migrate 的 PLATFORM_DATABASE_URL        |
# | b2b_tenant_default    | 擁有預設租戶的 DB（POSTGRES_DB）              | DEFAULT_TENANT_DATABASE_URL（與佈建出來的租戶相同的模式） |
# | b2b_provisioner       | CREATEDB、CREATEROLE（NOSUPERUSER）          | TENANT_PROVISIONING_DATABASE_URL、db:drop-tenant |
# | b2b_monitor           | pg_monitor（只讀統計，讀不到業務資料）       | postgres-exporter（設了 POSTGRES_MONITOR_PASSWORD 才建立；docs/architecture/08-monitoring.md §6.1） |
#
# 已經初始化過的資料目錄不會再跑這支腳本；既有部署的切換步驟見 05-tenancy.md §7.1。
set -eu

: "${PLATFORM_POSTGRES_DB:=b2b_platform}"
: "${POSTGRES_PLATFORM_PASSWORD:?必須設定}"
: "${POSTGRES_TENANT_PASSWORD:?必須設定}"
: "${POSTGRES_PROVISIONER_PASSWORD:?必須設定}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v platform_db="$PLATFORM_POSTGRES_DB" \
  -v tenant_db="$POSTGRES_DB" \
  -v platform_password="$POSTGRES_PLATFORM_PASSWORD" \
  -v tenant_password="$POSTGRES_TENANT_PASSWORD" \
  -v provisioner_password="$POSTGRES_PROVISIONER_PASSWORD" <<'SQL'
CREATE ROLE b2b_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'platform_password';
CREATE ROLE b2b_tenant_default LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'tenant_password';
CREATE ROLE b2b_provisioner LOGIN NOSUPERUSER CREATEDB CREATEROLE PASSWORD :'provisioner_password';
-- 佈建時 CREATE DATABASE … OWNER <租戶角色> 需要能 SET ROLE 成那個角色；PG 16 起 CREATEROLE 建立的角色
-- 預設只給 ADMIN，這裡讓佈建角色自動取得它建立的角色的 SET 與 INHERIT
ALTER ROLE b2b_provisioner SET createrole_self_grant TO 'set, inherit';

CREATE DATABASE :"platform_db" OWNER b2b_platform;
-- POSTGRES_DB 由映像以 POSTGRES_USER 建立，這時還是空的：交給預設租戶的角色
ALTER DATABASE :"tenant_db" OWNER TO b2b_tenant_default;

-- 每個 database 只有自己的角色能連（與佈建出來的租戶一樣，ensureTenantDatabase）
REVOKE ALL ON DATABASE :"platform_db" FROM PUBLIC;
REVOKE ALL ON DATABASE :"tenant_db" FROM PUBLIC;
-- 佈建角色連到平台 DB 的伺服器執行 DDL（TENANT_PROVISIONING_DATABASE_URL 指向平台 DB）
GRANT CONNECT ON DATABASE :"platform_db" TO b2b_provisioner;

-- 慢查詢統計（shared_preload_libraries 在 compose 的 command 設定）
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL

# 監控用的角色（docker-compose.monitoring.yml 的 postgres-exporter）：沒有啟用監控的部署不建立
if [ -n "${POSTGRES_MONITOR_PASSWORD:-}" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v monitor_password="$POSTGRES_MONITOR_PASSWORD" <<'SQL'
CREATE ROLE b2b_monitor LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'monitor_password';
GRANT pg_monitor TO b2b_monitor;
SQL
fi


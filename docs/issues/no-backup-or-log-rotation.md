# production 沒有備份設定與還原程序，也沒有日誌輪替

## 現況

`docker-compose.prod.yml` 的資料只存在兩個 named volume（L287–289）：

- `postgres-data`：平台 DB，以及每個租戶的 database。
- `file-storage-data`：所有租戶的檔案。

repo 裡沒有備份服務、沒有 WAL 封存設定，repo 與 docs 也都沒有備份或還原的程序。
[`05-tenancy.md`](../architecture/05-tenancy.md) §10.2 選擇方案 C 的理由之一是「可以單獨備份、還原」（L323），但沒有寫要怎麼做。

主金鑰只存在環境變數裡：

- `TENANT_SECRET_KEY`：解開每個租戶的連線字串（`tenants.database_url_encrypted`）。租戶 DB 角色的密碼是佈建時隨機產生的，只存在這個密文裡。
- `IDP_SECRET_KEY`、`WEBHOOK_SECRET_KEY`：解開外部 IdP 的 client secret 與 webhook 的簽章密鑰。
- `OIDC_JWKS`：簽 ID token 的私鑰。

會刪掉資料、無法復原的操作有：`trash.purge`（回收桶到期永久刪除）、`pnpm db:drop-tenant --confirm`、`pnpm db:reset`。

日誌的設定：

- compose 的服務都沒有 `logging:` 設定。Docker 預設的 json-file driver 不會輪替，除非主機的 `daemon.json` 另外設定。
- nginx 的存取日誌與 api 的 pino 日誌都寫到 stdout，每個請求一筆。
- migrate 的日誌裡可能有初始平台管理者的一次性設定連結（1 小時有效；2026-10-06 起不再印密碼）。
- Docker 的 named volume 預設都在 `/var/lib/docker`，與日誌在同一顆磁碟上。

## 影響

- 主機或 volume 損壞、誤刪資料、刪錯租戶之後，沒有可以還原的資料，也沒有演練過的程序。
- 遺失 `TENANT_SECRET_KEY` 時，平台 DB 裡所有租戶的連線字串都解不開。
  要恢復服務，得以超級使用者重設每個租戶角色的密碼，再用新的金鑰重新加密。
- 日誌不輪替會塞滿磁碟。postgres 與 file-storage 的 volume 在同一顆磁碟上時，資料庫也會因為磁碟滿而停擺。
- 這是「還沒做」的部署設定，正式上線前需要決定。

## 修正方式

1. 寫一份備份與還原手冊，放在 `docs/architecture/05-tenancy.md` §7 或新的部署文件。內容包括：
   - postgres：平台 DB 與每個租戶 DB 各自 `pg_dump`，對應「每個租戶可以單獨還原」的設計；或以 WAL 封存做時間點還原（PITR）。備份要放在主機以外。
   - file-storage：volume 與 DB 在接近的時間點做快照，並說明 DB 與物件不一致時怎麼處理，例如以檔案維護排程的對帳清掉沒有紀錄的物件。
   - 主金鑰：存進秘密管理服務，與資料備份分開保存，並寫下輪替與遺失時的處理步驟。
   - 定期做還原演練，並記錄結果。
2. 日誌輪替（擇一）：
   - 在 compose 的每個服務加上：

     ```yaml
     logging:
       driver: json-file
       options: { max-size: '50m', max-file: '5' }
     ```

   - 或在主機的 `/etc/docker/daemon.json` 設定 `log-opts`，並寫進部署文件。
3. 需要長期保存的日誌，送到集中式日誌系統，並設定保留期限。

## 驗證方式

- 做一次還原演練：從備份還原到另一台主機，平台與至少一個租戶都能登入，檔案也能下載。
- `docker inspect <容器> --format '{{.HostConfig.LogConfig}}'` 顯示 `max-size` 與 `max-file`。

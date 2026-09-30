# 租戶（每個租戶一個 database 與網域）

決定與理由見 [ADR-0020](../adr/0020-physical-tenant-isolation.md)（D1–D26 與「實作時改掉的做法」）。
這份文件描述做出來的樣子：請求怎麼找到租戶、連線與脈絡、migration、租戶的生命週期、周邊元件怎麼分租戶、部署與腳本。
身分（租戶的使用者與平台管理者）與 OIDC 的部分見 [`04-sso.md`](./04-sso.md) §1.1。

## 1. 全貌

```
  acme.example.com ─┐                         ┌───────────── 平台 DB（一個）─────────────┐
  beta.example.com ─┼─▶ 反向代理（Host 原樣轉發）─▶ apps/api ─▶│ tenants、tenant_domains、platform_admins、   │
  auth.example.com ─┘                     │                  │ platform_*、oidc_payloads、pgboss（佇列）      │
                                          │                  └──────────────────────────────────────────┘
                                          │  依 Host 選連線池
                                          ├─▶ 租戶 DB：acme（users、roles、files、audit_logs、job_outbox…）
                                          └─▶ 租戶 DB：beta
```

- **兩種資料庫**：平台 DB 只有「租戶之外」的東西；每個租戶一個 database，放那個租戶的全部業務資料（D1）。
  兩套 Drizzle schema、兩條 migration 線（`src/db/platform/`、`src/db/schema/`）。
- **網域決定租戶**（D2）：backstage 前端完全不知道租戶，每個租戶用自己的網域。apps/auth 的網域不屬於任何租戶。
- **兩份身分**（D5）：租戶的 `users` 在各租戶 DB；平台管理者（apps/auth）在平台 DB。同一個 email 在兩處是兩個帳號。
- **一個 api 程序服務所有租戶**：記憶體裡的東西（快取、推播的 room）一律帶租戶（D17）。

## 2. 請求怎麼找到租戶（`core/tenant`）

`TenantMiddleware` 在所有路由之前執行（含 `/oidc/*`）：

| 請求的網域 | 結果 |
| --- | --- |
| 登記在 `tenant_domains` 的網域（先比 `host:port`，再比主機名稱） | 進入那個租戶的脈絡 |
| apps/auth 的網域（`AUTH_APP_URL` 的 host） | 沒有租戶；帳號流程以 `X-Tenant: <代碼>` 指定租戶（D26，這個標頭只在 apps/auth 的網域有效） |
| 其他 | 沒有租戶；需要租戶的程式第一次存取 `TENANT_DB` 時拋 `404 TENANT_NOT_FOUND`，健康檢查照常 |

- Host 取自 `requestHost()`：只有受信任的代理（`TRUST_PROXY`）帶來的 `X-Forwarded-Host` 才採用，不能靠標頭換租戶。
  所以受信任的代理 **必須覆寫** 這個標頭：兩份 nginx 設定都 `proxy_set_header X-Forwarded-Host $http_host`
  （[`01-system.md`](./01-system.md) §4.2）；前面另有 LB 時同樣要求。
- `TenantDirectory` 快取查詢結果（含「找不到」）`TENANT_CACHE_TTL` 秒；租戶管理改了登記時 `invalidate()` 立即生效。
  另有「網域 → 租戶 id」的同步快照，給 oidc-provider 的同步判斷（redirect URI 是否屬於租戶）用。
- 租戶不能進入時回 `503 TENANT_UNAVAILABLE`，`details.reason` 分兩種：`inactive`（停用、佈建中、佈建失敗）與
  `maintenance`（migration 落後、DB 連不上）。背景工作依此決定略過或重試（§6）。

## 3. 連線與脈絡

| 元件 | 做什麼 |
| --- | --- |
| `TenantContext`（AsyncLocalStorage） | `{ id, code, db, storageBucket, allowExternalIdp }`；`currentTenant()`、`requireTenant()` 讀取 |
| `TENANT_DB` | repository 注入的 Proxy：每次存取都轉到 **目前租戶** 的 `db`；沒有脈絡時拋 `TENANT_NOT_FOUND`，不會退回任何預設 DB |
| `PLATFORM_DB` | 平台 DB（租戶登記、平台管理者、佇列、OIDC 的協定狀態） |
| `Tenancy.enter(record)` | 進入租戶的唯一入口：檢查狀態與 migration 版本，建立（或沿用）那個租戶的連線池 |
| `Tenancy.run(id, fn)` | 以 id 進入（背景工作、外部 IdP 的 callback 等不在租戶網域上的程式） |
| `Tenancy.forEachActive(fn)` | 依序在每個 `active` 租戶執行（啟動時的準備、排程展開）；單一租戶失敗不影響其他 |
| `Tenancy.runForMaintenance(id, fn)` | 不看狀態進入（仍檢查版本）：停用 **之後** 撤銷 session 用 |
| `Tenancy.evict(id)` | 關掉連線池（停用、刪除之後） |

- 每個租戶一個小連線池（`TENANT_POOL_MAX`，閒置連線 60 秒關閉）。連線字串以 `TENANT_SECRET_KEY` 加密存在
  `tenants.database_url_encrypted`（D4），每個租戶有自己的 DB 角色，只能連自己的 database。
- WebSocket 在 handshake 時依網域決定租戶，之後這條連線上的每則訊息都在那個租戶的脈絡裡處理
  （[`backend/08-realtime.md`](./backend/08-realtime.md)）。

## 4. Migration 與版本檢查

- `pnpm db:migrate` 先跑平台 DB，再依序跑每個未刪除的租戶；單一租戶失敗不影響其他租戶，最後列出失敗的租戶並以非零結束（D14）。
- api 不自己跑 migration，而是在 `Tenancy.enter()` 比對租戶 DB 的最後一筆套用紀錄與程式的 journal：落後的租戶回 503、
  每 30 秒重新檢查；DB 比程式新照常服務（migration 必須對上一版程式相容）。細節見
  [`backend/02-database.md`](./backend/02-database.md) §5.2、§5.3。
- migration 的 SQL 由 nest-cli 的 assets 複製進 `dist/src/db/`（兩條線），`db:migrate` 與佈建共用 `src/db/provision.ts`。

## 5. 租戶的生命週期

```
  建立（apps/auth）──▶ provisioning ──佈建成功──▶ active ◀──啟用── disabled
                          │                        │ 停用 ─────────────▲
                          └─佈建失敗─▶ failed ──重試─┘          刪除（標記）──▶ pnpm db:drop-tenant（手動清除）
```

| 動作 | 端點（apps/auth，平台權限） | 做什麼 |
| --- | --- | --- |
| 建立 | `POST /platform/tenants`（`tenant:create`） | 登記租戶（`provisioning`）：代碼、名稱、第一位管理員的 email；預設網域 `{code}.<TENANT_BASE_DOMAIN>`（D24）；產生 database 與 DB 角色的名稱（`tenant_{code}_{8 位隨機}`）與密碼、bucket（`b2b-{code}`，用過就加序號）；排入佈建工作 |
| 佈建 | 背景工作 `tenant.provision`（平台工作，不自動重試） | ① 建立 DB 角色與 database（`TENANT_PROVISIONING_DATABASE_URL`，要有 `CREATEDB` 與 `CREATEROLE`）② 跑租戶 migration ③ 權限目錄、系統角色、第一位 super-admin（`pending`）④ 改成 `active` ⑤ 在租戶脈絡裡寄啟用信、確認 bucket、發佈 `TENANT_ACTIVATED`（檔案的系統資料夾）。①–④ 失敗停在 `failed`（原因記在 `provision_error`）；⑤ 的失敗不改狀態，只記原因 |
| 重試佈建 | `POST /platform/tenants/:id/provision`（`tenant:create`） | 只接受 `failed`；每一步都冪等（角色存在就把密碼改回來、database 存在就沿用） |
| 改名、網域、外部 IdP 開關 | `PATCH /platform/tenants/:id`、`POST|DELETE …/domains`（`tenant:update`） | 網域一個只屬於一個租戶、不能移除最後一個、apps/auth 的網域不能登記；`allowExternalIdp` 關掉時租戶不能新增或啟用外部 IdP 連線，登入時也不走連線（D22） |
| 停用 | `POST /platform/tenants/:id/disable`（`tenant:update`） | **先改狀態再收尾**：撤銷 app session、刪除這個租戶帳號（`t:{tenantId}:*`）在 IdP 的 session／grant、斷掉 `t:{tenantId}` room 的即時連線、關掉連線池。網域之後一律 503 |
| 啟用 | `POST /platform/tenants/:id/enable` | 回到 `active`，發佈 `TENANT_ACTIVATED` |
| 刪除 | `DELETE /platform/tenants/:id`（`tenant:delete`） | 停用並收尾、標記刪除、釋出網域；代碼之後可以給新租戶。database 與 bucket 留著 |
| 清除 | `pnpm db:drop-tenant <代碼或 id> [--confirm]` | 只處理已刪除、database 名稱是佈建產生的租戶：清空並刪除 bucket、`DROP DATABASE … WITH (FORCE)`、`DROP ROLE`、刪除 IdP 殘留與佇列裡的工作、移除登記。不加 `--confirm` 只列出 |

每個動作都寫平台稽核（`platform_audit_logs`，D19）。管理頁在 apps/auth 的 `/tenant`、`/tenant/$id`。

## 6. 周邊元件怎麼分租戶

| 元件 | 做法 | 詳見 |
| --- | --- | --- |
| 背景工作 | 佇列在平台 DB；信封 `{ tenantId, payload }`，handler 在那個租戶裡執行。交易內入列寫租戶 DB 的 `job_outbox`，提交後搬進佇列。排程觸發的租戶工作展開成每個 `active` 租戶一筆。租戶已刪除或停用時略過；`maintenance` 交給重試 | [`backend/10-jobs.md`](./backend/10-jobs.md) |
| 權限／使用者快取 | key 是 `{tenantId}:{userId}` | [`backend/05-rbac.md`](./backend/05-rbac.md) §5 |
| 即時推播 | room 帶租戶：`t:{tenantId}:perm:{key}`、`t:{tenantId}:user:{id}`、`t:{tenantId}`；Origin 同源（租戶自己的網域）一律允許 | [`backend/08-realtime.md`](./backend/08-realtime.md) §6、§11 |
| 物件儲存 | 每個租戶一個 bucket（`tenants.storage_bucket`）；presigned URL 以 `FILE_STORAGE_PUBLIC_ENDPOINT` 的 `{tenantOrigin}` 簽成租戶自己網域的 `/storage` | [`backend/09-file.md`](./backend/09-file.md) §3、§3.1 |
| 寄信 | 產品頁面的連結用租戶的主要網域（找不到就拋錯重試）；帳號流程的連結在 apps/auth、帶 `?tenant=` | [`backend/11-mail.md`](./backend/11-mail.md) |
| 稽核 | 租戶內的動作寫租戶的 `audit_logs`；平台管理者的動作寫 `platform_audit_logs`，兩邊互相看不到 | [`backend/06-audit-log.md`](./backend/06-audit-log.md) |
| 外部 IdP | 連線在租戶 DB，由租戶的管理者在 backstage 設定；平台只有開關 | [`04-sso.md`](./04-sso.md) |
| 領域事件 | 在發佈者的租戶脈絡裡傳給訂閱者；`TENANT_ACTIVATED` 讓每個租戶一份的初始資料在佈建、重新啟用時補上 | `core/events` |
| Access token | 帶 `tid`（租戶）或 `realm: 'platform'`；拿到別的網域一律無效 | [`backend/04-auth.md`](./backend/04-auth.md) |

## 7. 部署

- **DNS 與 TLS**：租戶的預設網域是 `{code}.<TENANT_BASE_DOMAIN>`，所以 `*.<TENANT_BASE_DOMAIN>` 要有 wildcard DNS 與
  wildcard 憑證（TLS 由前面的 LB／ingress 終結）。客戶自己的網域要另外設 DNS 與憑證，再由平台管理者加到租戶上。
- **反向代理**：backstage 的 nginx 是 `server_name _`，任何網域都由它服務，並把 `Host`（含 port）原樣轉給 api 與
  file-storage（`deploy/nginx.conf`）。apps/auth 是另一個 origin（`deploy/nginx.auth.conf`）。
- **同源**：每個租戶的頁面、`/api`、`/storage`、WebSocket 都在自己的網域，CSP 維持 `connect-src 'self'`。
- **單一 api 執行個體**：租戶狀態的變更（停用、網域）只在本程序立即生效，其他執行個體最多晚 `TENANT_CACHE_TTL` 秒；
  WebSocket 也是單機的 adapter。擴成多個執行個體的前提見 [`01-system.md`](./01-system.md) §4.3。

| 環境變數 | 用途 |
| --- | --- |
| `PLATFORM_DATABASE_URL` | 平台 DB |
| `TENANT_SECRET_KEY` | 加密租戶連線字串（production 必填；開發時由 `JWT_SECRET` 推導） |
| `TENANT_POOL_MAX`、`TENANT_CACHE_TTL` | 每個租戶的連線池上限、租戶登記的快取秒數 |
| `TENANT_PROVISIONING_DATABASE_URL` | 佈建新租戶用（`CREATEDB`＋`CREATEROLE`）；留空用 `PLATFORM_DATABASE_URL` |
| `TENANT_BASE_DOMAIN` | 新租戶預設網域的上層；留空用 `APP_PUBLIC_URL` 的 host（開發：`acme.localhost:5173`） |
| `DEFAULT_TENANT_CODE`／`NAME`／`DATABASE_URL`／`DOMAINS`／`STORAGE_BUCKET` | `db:migrate` 在平台 DB 還沒有租戶時登記的預設租戶 |
| `PLATFORM_ADMIN_EMAIL`、`PLATFORM_ADMIN_PASSWORD` | `db:seed` 建立的第一位平台管理者（`super-admin`） |
| `SEED_TENANT` | `db:seed` 建立 `SUPER_ADMIN_EMAIL` 的租戶、`db:seed:dev`／`e2e` 的目標租戶（預設 `default`） |
| `FILE_STORAGE_PUBLIC_ENDPOINT` | 預設 `{tenantOrigin}/storage`；真正的 S3 填固定網址 |

## 8. 腳本

| 指令 | 範圍 |
| --- | --- |
| `pnpm db:migrate` | 平台 DB ＋ 每個未刪除的租戶；平台 DB 沒有租戶時登記預設租戶 |
| `pnpm db:seed` | 第一位平台管理者；每個 `active`、`disabled` 租戶補權限目錄與系統角色；`SUPER_ADMIN_EMAIL` 只建在 `SEED_TENANT` |
| `pnpm db:seed:dev`、`db:seed:e2e` | `SEED_TENANT` 一個租戶 |
| `pnpm db:reset` | 清空平台 DB 的協定狀態與 session，以及每個租戶的業務資料（production 禁止） |
| `pnpm db:archive-audit-logs` | 每個 `active` 租戶的稽核冷熱搬移 |
| `pnpm db:drop-tenant` | §5 的清除 |

## 9. 測試

| 層 | 涵蓋 |
| --- | --- |
| 單元 | `Tenancy`（狀態、版本檢查與重新檢查、`runForMaintenance`、`evict`）、`JobQueue` 對租戶不能進入的處理、`S3ObjectStorage` 的每租戶 bucket 與 presigned 網域、`MailService` 的租戶網域 |
| 整合（`apps/api/test`） | `tenancy.spec.ts`（兩個租戶的帳號、token、資料互不相通；未知網域、停用、migration 落後）、`platform-tenant.spec.ts`（建立 → 佈建 → 啟用信 → 登入；網域；停用清掉 IdP 的 session；刪除後網域釋出）、`platform-admin.spec.ts`（平台管理者、稽核、背景工作、外部 IdP 開關）、`sso.spec.ts`（OIDC 帶租戶） |
| E2E（`apps/e2e/tests/tenancy.spec.ts`） | 平台管理者在 apps/auth 建立租戶，第一位管理員從啟用信進入 `{code}.localhost:5173`；同一個 IdP session 換租戶要重新登入；授權碼送到別的租戶的 BFF → `AUTH_SSO_CODE_INVALID`；authorize 的租戶與 redirect URI 不一致 → `invalid_request`、沒有授權碼；停用後網域 503 |

HTTP 整合測試一律以 `listenOnLoopback(app)` 取得 server（[`../conventions/04-testing.md`](../conventions/04-testing.md) §3）。
E2E 會 `db:reset`：跑之前一定要帶暫用 DB 的 `PLATFORM_DATABASE_URL`、`DEFAULT_TENANT_*`，否則會清空共用的開發資料庫。

# 租戶（每個租戶一個 database 與網域）

決定與理由見 §10（D1–D26 與「實作時改掉的做法」）；feature flag、可關閉的 feature、feature 參數、租戶用量、未開放的 feature 一律隱藏的決定見 §11～§15。
這份文件描述做出來的樣子：請求怎麼找到租戶、連線與脈絡、migration、租戶的生命週期與用量、周邊元件怎麼分租戶、部署與腳本。
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
- **網域決定租戶**（D2）：backstage 前端完全不知道租戶，每個租戶用自己的網域。apps/platform 的網域不屬於任何租戶。
- **兩份身分**（D5）：租戶的 `users` 在各租戶 DB；平台管理者（apps/platform）在平台 DB。同一個 email 在兩處是兩個帳號。
- **一個 api 程序服務所有租戶**：記憶體裡的東西（快取、推播的 room）一律帶租戶（D17）。

## 2. 請求怎麼找到租戶（`core/tenant`）

`TenantMiddleware` 在 Nest 的路由之前執行（`/oidc/*` 由 provider 的 middleware 自己處理，見下方）：

| 請求的網域 | 結果 |
| --- | --- |
| 登記在 `tenant_domains` 的網域（先比 `host:port`，再比主機名稱） | 進入那個租戶的脈絡 |
| apps/platform 的網域（`PLATFORM_APP_URL` 的 host） | 沒有租戶；帳號流程以 `X-Tenant: <代碼>` 指定租戶（D26）。這個標頭只在 apps/platform 的網域、而且只對帳號流程的端點有效（`/auth/setup`、`/auth/setup/verify`、`/auth/register`、`/auth/forgot-password`、`/auth/reset-password`、`/system/settings/public`，不分大小寫）；其他路由不採用，租戶的 access token 因此不能經由平台網域使用 |
| 其他 | 沒有租戶；需要租戶的程式第一次存取 `TENANT_DB` 時拋 `404 TENANT_NOT_FOUND`，健康檢查照常 |

對外 API（另一個程序，[`06-external-api.md`](./06-external-api.md)）不看網域：`TokenTenantMiddleware` 以 API token 的租戶代碼
找租戶（`findByCode`），全平台只有一個對外網域。

平台管理者的端點（`/platform/*`）與 IdP（`/oidc/*`、`/oidc-interaction/*`）**只在 apps/platform 的網域有效**：租戶網域、未登記的網域、
直接以 IP 連線一律回 `404 PLATFORM_ONLY`，只套在 apps/platform 網域上的網路控制（WAF、IP 白名單）才保護得到平台管理與登入。

- 路徑比對不分大小寫：Express 的路由不分大小寫，`/PLATFORM/tenants` 也會進到 `platform/tenants` 的 handler。
- `TenantMiddleware` 把「是不是 apps/platform 的網域」記在請求脈絡（`isPlatformHostRequest()`）；`JwtAuthGuard`、
  `PermissionsGuard` 的平台端點與平台的帳號端點（`assertPlatformHost`）看它，不以「沒有租戶」代替——未登記的網域也沒有租戶。
- `/oidc/*` 不是 Nest 的路由，provider 的 middleware 比 `TenantMiddleware` 先執行，所以它自己比對 Host。

- Host 取自 `requestHost()`：只有受信任的代理（`TRUST_PROXY`）帶來的 `X-Forwarded-Host` 才採用，不能靠標頭換租戶。
  所以受信任的代理 **必須覆寫** 這個標頭：兩份 nginx 設定都 `proxy_set_header X-Forwarded-Host $http_host`
  （[`01-system.md`](./01-system.md) §4.2）；前面另有 LB 時同樣要求。
- `TenantDirectory` 快取查詢結果 `TENANT_CACHE_TTL` 秒（「找不到」最多 5 秒）；租戶管理改了登記時 `invalidate()` 立即生效，
  並經平台 DB 廣播（頻道 `tenant_directory`）讓其他程序也整份重新讀（[`01-system.md`](./01-system.md) §4.4）。
  另有「網域 → 租戶 id」的同步快照（每 `TENANT_CACHE_TTL` 秒重載），給 oidc-provider 的同步判斷（redirect URI 是否屬於租戶）用。
  「立即生效」靠兩道防線：查詢前先取票（`InvalidationTracker`），查詢期間被 `invalidate()` 過的結果不寫回快取（例：停用租戶的交易剛提交，
  回來的仍是 `active`）；快照的重新載入以序號判斷，先開始、後回來的舊結果不蓋掉較新的快照。
- **Host 由客戶端決定、而且在速率限制之前解析**：不在快照裡的 Host 直接視為找不到，不查平台 DB；格式不像網域或租戶代碼的值
  （`X-Tenant`、`/tenants/lookup?code=`）也不查。三個快取（網域、id、代碼）都是有上限的 LRU（`bounded-cache.ts`，各 5000 筆）。
  代價：漏掉廣播時，另一個程序剛新增的網域，這裡最多晚 `TENANT_CACHE_TTL` 秒才認得。
- 租戶不能進入時回 `503 TENANT_UNAVAILABLE`，`details.reason` 分兩種：`inactive`（停用、佈建中、佈建失敗）與
  `maintenance`（migration 落後、DB 連不上）。背景工作依此決定略過或重試（§6）。

## 3. 連線與脈絡

| 元件 | 做什麼 |
| --- | --- |
| `TenantContext`（AsyncLocalStorage） | `{ id, code, db, storageBucket, features, flags, featureParams, domain? }`；`currentTenant()`、`requireTenant()` 讀取。`domain` 是 `TenantMiddleware` 以網域找到租戶時比對到的網域（瀏覽器看到的 `host[:port]`），presigned 網址以它簽（[`backend/09-file.md`](./backend/09-file.md) §3）；背景工作、對外 API、`X-Tenant` 沒有 |
| `TENANT_DB` | repository 注入的 Proxy：每次存取都轉到 **目前租戶** 的 `db`；沒有脈絡時拋 `TENANT_NOT_FOUND`，不會退回任何預設 DB |
| `PLATFORM_DB` | 平台 DB（租戶登記、平台管理者、佇列、OIDC 的協定狀態） |
| `Tenancy.enter(record)` | 進入租戶的唯一入口：檢查狀態與 migration 版本，建立（或沿用）那個租戶的連線池 |
| `Tenancy.run(id, fn)` | 以 id 進入（背景工作、外部 IdP 的 callback 等不在租戶網域上的程式） |
| `Tenancy.forEachActive(fn)` | 依序在每個 `active` 租戶執行（啟動時的準備、排程展開）；單一租戶失敗不影響其他 |
| `Tenancy.runForMaintenance(id, fn)` | 不看狀態進入（仍檢查版本）：停用 **之後** 撤銷 session 用 |
| `Tenancy.evict(id)` | 關掉連線池（停用、刪除之後） |

- 每個租戶一個小連線池（`TENANT_POOL_MAX`，閒置連線 `TENANT_POOL_IDLE_TIMEOUT` 秒關閉；連線預算見 [`backend/02-database.md`](./backend/02-database.md) §6.2）。連線字串以 `TENANT_SECRET_KEY` 加密存在
  `tenants.database_url_encrypted`（D4），每個租戶有自己的 DB 角色，只能連自己的 database。
- WebSocket 在 handshake 時依網域決定租戶，之後這條連線上的每則訊息都在那個租戶的脈絡裡處理
  （[`backend/08-realtime.md`](./backend/08-realtime.md)）。

## 4. Migration 與版本檢查

- `pnpm db:migrate` 先跑平台 DB，再依序跑每個未刪除、而且不是佈建中（`provisioning`）或佈建失敗（`failed`）的租戶（D14）。
  佈建中、佈建失敗的租戶由佈建與「重試佈建」跑 migration。單一租戶失敗不影響其他租戶，最後列出失敗的租戶；
  只有平台 DB 失敗才以非零結束（`--strict` 時租戶失敗也非零，給 CI 用），所以一個租戶壞掉不會擋住 api 啟動。
- api 不自己跑 migration，而是在 `Tenancy.enter()` 比對租戶 DB 的最後一筆套用紀錄與程式的 journal：落後的租戶回 503、
  每 30 秒重新檢查；DB 比程式新照常服務（migration 必須對上一版程式相容）。細節見
  [`backend/02-database.md`](./backend/02-database.md) §5.2、§5.3。
- migration 的 SQL 由 nest-cli 的 assets 複製進 `dist/src/db/`（兩條線，以資料夾為單位並開 `watchAssets`：`pnpm dev` 跑著時新加的 migration 與改過的 `_journal.json` 也會同步，api 隨之重啟），`db:migrate` 與佈建共用 `src/db/provision.ts`。

## 5. 租戶的生命週期

```
  建立（apps/platform）──▶ provisioning ──佈建成功──▶ active ◀──啟用── disabled
                          │                        │ 停用 ─────────────▲
                          └─佈建失敗─▶ failed ──重試─┘          刪除（標記）──▶ pnpm db:drop-tenant（手動清除）
```

| 動作 | 端點（apps/platform，平台權限） | 做什麼 |
| --- | --- | --- |
| 清單 | `GET /platform/tenants`（`tenant:read`） | 未刪除的租戶，依建立時間舊到新；伺服器分頁（`offset`、`limit` 預設 50、最多 100）、`q` 比對代碼／名稱／任一網域（部分相符、不分大小寫）、`status` 篩選；回應另帶 `baseDomain`（建立時的預設網域上層） |
| 建立 | `POST /platform/tenants`（`tenant:create`） | 登記租戶（`provisioning`）：代碼（未刪除的租戶之間唯一，`409 TENANT_CODE_TAKEN`）、名稱、第一位管理員的 email；預設網域 `{code}.<TENANT_BASE_DOMAIN>`（D24）；產生 database 與 DB 角色的名稱（`tenant_{code}_{8 位隨機}`）與密碼、bucket（`b2b-{code}`，用過就加序號）；排入佈建工作 |
| 佈建 | 背景工作 `tenant.provision`（平台工作，不自動重試） | ① 建立 DB 角色與 database（`TENANT_PROVISIONING_DATABASE_URL`，要有 `CREATEDB` 與 `CREATEROLE`）② 跑租戶 migration ③ 權限目錄、系統角色、第一位 super-admin（`pending`）④ 改成 `active` ⑤ 在租戶脈絡裡寄啟用信、確認 bucket、發佈 `TENANT_ACTIVATED`（檔案的系統資料夾）。①–④ 失敗停在 `failed`（原因記在 `provision_error`）；⑤ 的失敗不改狀態，只記原因 |
| 重試佈建 | `POST /platform/tenants/:id/provision`（`tenant:create`） | 只接受 `failed`；每一步都冪等（角色存在就把密碼改回來、database 存在就沿用） |
| 佈建中斷 | 背景工作 `tenant.provisionSweep`（每 5 分鐘）；重試與刪除前也先跑一次 | 程序在佈建途中被重啟時，工作在逾時（15 分鐘）後被收回，租戶卻停在 `provisioning`：超過逾時 5 分鐘的改成 `failed`（`provision_error` 寫「佈建中斷」），之後就能重試或刪除 |
| 改名、網域、平台層開關 | `PATCH /platform/tenants/:id`、`POST|DELETE …/domains`（`tenant:update`） | 網域一個只屬於一個租戶（`409 TENANT_DOMAIN_TAKEN`）、不能移除最後一個（`TENANT_LAST_DOMAIN`）與主要網域（第一個，`TENANT_PRIMARY_DOMAIN`）、apps/platform 的網域不能登記；`features`、`flags`、`mfaMethods` 見 §5.1 |
| 停用 | `POST /platform/tenants/:id/disable`（`tenant:update`） | **先改狀態再收尾**：撤銷 app session、刪除這個租戶帳號（`t:{tenantId}:*`）在 IdP 的 session／grant、斷掉 `t:{tenantId}` room 的即時連線、關掉連線池。網域之後一律 503 |
| 啟用 | `POST /platform/tenants/:id/enable` | 回到 `active`，發佈 `TENANT_ACTIVATED` |
| 刪除 | `DELETE /platform/tenants/:id`（`tenant:delete`） | 停用並收尾、標記刪除、釋出網域；代碼之後可以給新租戶。database 與 bucket 留著 |
| 清除 | `pnpm db:drop-tenant <代碼或 id> [--confirm]` | 只處理已刪除、database 名稱是佈建產生的租戶：清空並刪除 bucket、`DROP DATABASE … WITH (FORCE)`、`DROP ROLE`、刪除 IdP 殘留與佇列裡的工作、移除登記。不加 `--confirm` 只列出 |

狀態不允許的操作（例：停用不是 `active` 的租戶、刪除佈建中的租戶）回 `409 TENANT_STATUS_CONFLICT`。

每個動作都寫平台稽核（`platform_audit_logs`，D19），**與狀態或網域的變更在同一個平台 DB 交易**：稽核寫不進去，變更也不生效。
停用、刪除的收尾（撤銷 session、IdP、連線池）在交易之後，失敗的步驟另外記一筆 `tenant.disable.cleanup`（或寫進 `tenant.delete` 的
`cleanupFailed`）。網域的增刪先鎖住租戶列（`FOR UPDATE`）再數網域，同時移除兩個網域不會把網域移光。
管理頁在 apps/platform 的 `/tenant`、`/tenant/$id`。

### 5.1 平台層開關

平台管理者在租戶詳情頁開關、存在平台 DB 的 `tenants`，經 `TenantDirectory` 進到每個請求的 `TenantContext`。
租戶自己的管理者看得到結果，但不能改。

| 欄位 | 值 | 效果 | 出處 |
| --- | --- | --- | --- |
| `features` | `text[]`，預設全部（`{file,auditLog,job,trash,systemSetting,identityProvider,tenantSwitch,webhook,announcement,externalApi,group,dataTransfer,organization,approvalChain,gallery}`） | 可啟用 feature 的 id（`core/tenant/tenant-features.ts` 的 `TENANT_FEATURES`）。沒列出的 feature：api 以 `@RequireFeature()` 標的端點回 `404 FEATURE_DISABLED`（`common/guards/feature.guard.ts`；handler 與 class 的宣告合併，全部都要啟用）；`/auth/profile` 的 `features` 不含它，前端不安裝它。該 feature 的背景工作照常執行，資料保留 | [`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9.2 D8、D11、§12、[`backend/17-webhook.md`](backend/17-webhook.md) §9.2 D8 |
| `flags` | `jsonb`，預設 `{}` | feature flag 的租戶層覆寫 `{ [key]: boolean }`，沒列出 = 跟著全平台與預設值；見 §5.2 | §11.2 D2 |
| `feature_params` | `jsonb`，預設 `{}` | feature 參數（配額與上限）的覆寫 `{ [key]: number \| string }`，沒列出 = 預設值；見 §5.3 | §13.2 D2 |
| `mfa_methods` | `jsonb`，預設 `{}` | MFA 驗證方式的租戶層開關 `{ [方式 id]: boolean }`，規則與 `flags` 相同（`resolveToggle`）；在租戶詳情的「多重驗證」分頁設定 | [`backend/21-mfa.md`](backend/21-mfa.md) §5 |

各 feature 停用時的效果：

| id | 停用時 | 照舊 |
| --- | --- | --- |
| `file` | `/files`、`/file-folders` 回 404；backstage 沒有檔案頁 | 檔案與物件、背景工作 |
| `auditLog` | `/audit-logs` 回 404；沒有稽核頁 | 稽核照常寫入、封存 |
| `job` | `/jobs` 回 404；沒有背景工作頁 | 工作照常執行 |
| `trash` | `GET /trash` 與各資源的 `POST …/:id/restore` 回 404；沒有回收桶頁，刪除的提示沒有「復原」 | 刪除仍是軟刪除，`trash.purge` 在保留期滿後永久刪除 |
| `systemSetting` | `GET`／`PATCH /system/settings` 回 404；沒有系統設定頁 | 已覆寫的值照樣生效；`/system/settings/public` 不受影響 |
| `identityProvider` | `/identity-providers` 回 404；登入時當作沒有連線（email 網域不導向外部 IdP，只允許 SSO 的網域回到密碼登入） | 連線與外部身分的連結保留 |
| `tenantSwitch` | backstage 帳號選單沒有「切換租戶」 | apps/platform 的 `/enter` |
| `announcement` | `/announcements`、`/me/announcement-messages` 回 404；沒有公告頁；已入列的排程與分批寫入略過（期間錯過的時間不補發） | 公告與發送紀錄保留 |
| `webhook` | `/webhooks` 回 404；沒有 Webhook 頁；`emit()` 不寫事件也不入列，已入列的投遞略過（期間的事件之後不補送） | 訂閱與投遞紀錄保留；`webhook.cleanup` 照常清理 |
| `group` | `/groups` 回 404；沒有群組頁，其他頁面的群組欄位（角色的「經由群組」、使用者的所屬群組、公告受眾、資料夾授權的對象）隱藏；**群組帶來的授權全部暫停**（成員不經由群組取得角色、資料夾授權、公告受眾），不能新增群組的資料夾授權 | 群組、成員與授權的邊（關係圖不寫入）；重新打開後立即恢復（[`iam/07-groups.md`](./iam/07-groups.md) §8） |
| `externalApi` | 服務帳號與對外 API 共用的開關：對外 API 的每個路由（`@ExternalApi()`，不必另標）以有效的 API token 呼叫時回 404，無效的 token 照舊 401；`/service-accounts`、`/auth/api-tokens`、`/users/:userId/api-tokens` 回 404；沒有服務帳號頁，個人資料與使用者詳情沒有 API token 區塊 | 服務帳號（`users` 的列）與它的角色、token 與期限；重新打開後原本的 token 立即可用。健康檢查不受影響（[`06-external-api.md`](./06-external-api.md) §3.1） |
| `organization` | `/org-units`、`/users/:id/org-units` 回 404，`GET /users?orgUnitId=` 回 400；沒有組織頁、使用者詳情的「所屬部門」與列表的部門篩選；審批的 `manager`／`orgUnit` 規則展開為空（關卡短缺，交給 `approval:override`） | 部門、成員與主管；重新打開後一致（[`backend/23-organization.md`](./backend/23-organization.md) §6） |
| `approvalChain` | `/approval-flows` 與關卡的決定、override、refresh 回 404；沒有審批流程頁與「待我審核」；新申請一律單關，進行中的多關請求改由 `approval:review` 一次定案（剩下的關卡 `cancelled`） | 流程與已做出的決定；重新打開後未定案的請求從原關卡繼續（[`backend/20-approval.md`](./backend/20-approval.md) §9.11） |
| `dataTransfer` | `/data-transfers` 回 404；沒有「我的匯入匯出」與匯入頁，列表頁沒有匯出、匯入按鈕 | 進行中的匯出與套用照常完成；匯出檔與套用列照保留期限清除（[`backend/22-data-transfer.md`](./backend/22-data-transfer.md) §10） |
| `gallery` | `/gallery/items`、`/gallery/albums` 回 404；沒有圖片庫頁，檔案管理器沒有「加入圖片庫」、選圖沒有「圖片庫」分頁（前端 plugin 卸載，登記的動作與來源一起消失）；`POST /images/from-source` 指定 `gallery` 來源回 404 | 圖片、相簿與物件；`gallery.process` 照常完成、`gallery.maintenance` 照常清理（[`backend/26-gallery.md`](./backend/26-gallery.md) §11.4） |

- `PATCH /platform/tenants/:id` 的 `features` 是 **完整清單**（不是增減）；重複或不認得的 id 回 `VALIDATION_FAILED`，
  存進 DB 時依 `TENANT_FEATURES` 的順序。DB 裡殘留不認得的值（程式移除某個 feature 之後）讀取時濾掉。
- `flags` 同樣是 **完整的覆寫表**；不在 flag 目錄裡的 key 回 `VALIDATION_FAILED`，存進 DB 時依目錄的順序。
- 變更與平台稽核（`tenant.update`，`before`／`after` 帶 `name`、`features`、`flags`）在同一個交易；之後 `TenantDirectory.invalidate()`，
  本機立即生效，其他程序經廣播也立即生效（漏掉時最多晚 `TENANT_CACHE_TTL` 秒）。
- `features` 或 `flags` 真的改變時，失效之後發佈 `TENANT_FEATURES_CHANGED`（`{ tenantId }`），`modules/realtime` 對該租戶的
  `t:{tenantId}` room 推 `resource.changed`（來源 `tenantFeature`），前端據此重新取得 profile
  （[`backend/08-realtime.md`](./backend/08-realtime.md) §7）。平台的請求沒有租戶脈絡，所以事件以 `tenantId` 指明對象。
- 新增一個可啟用的 feature：`TENANT_FEATURES` 加 id → 決定既有租戶要不要啟用（要的話寫一支資料 migration，
  預設值也一併調整）→ controller 標 `@RequireFeature()` → `test/route-audit.spec.ts` 的對照 → 前端的 catalog
  → apps/platform 的 `TENANT_FEATURE_LABEL_KEY`／`TENANT_FEATURE_DESCRIPTION_KEY` 與語系。

### 5.2 Feature flag（試行開關）

決定與理由見 §11。§5.1 的 `features` 是 **長期的模組**（租戶買了什麼）；
feature flag 是 **暫時的上線開關**：新功能先合進 `main`、先開給試用的租戶、穩定後全面開放，最後連同開關與舊的程式碼路徑一起刪除。

**目錄**（`apps/api/src/core/feature-flags/feature-flags.ts` 的 `FEATURE_FLAGS`）：每個 flag 有 `key`（`<模組>.<名稱>`，camelCase）、
`description`、`defaultEnabled`、`owner`、`removeBy`（`YYYY-MM-DD`）。啟動時檢查格式、重複與日期；`removeBy` 過了還在目錄裡，
單元測試（`core/feature-flags/__tests__/feature-flags.spec.ts`）就失敗。目錄以 `FEATURE_FLAG_CATALOG` provider 注入，整合測試換成自己的目錄。
key 在 OpenAPI 上是字串（目錄常常是空的），由伺服器依目錄驗證。

**兩級覆寫**（都在平台 DB）：

| 層級 | 儲存 | 誰改 | 端點（apps/platform） |
| --- | --- | --- | --- |
| 租戶 | `tenants.flags`（§5.1） | `tenant:update` | `PATCH /platform/tenants/:id` 的 `flags` |
| 全平台 | `feature_flag_overrides`（`key`、`state`：`on` ｜ `off`、`updated_by`、`updated_at`；沒有列 = 不覆寫） | `featureFlag:update` | `PUT /platform/feature-flags/:key`（`{ state: 'default' \| 'on' \| 'off' }`） |

`GET /platform/feature-flags`（`featureFlag:read`）回目錄、全平台狀態與「覆寫成開／關的租戶數」。
全平台的切換寫平台稽核 `featureFlag.update`（`metadata`：`key`、`before`、`after`），與寫入在同一個交易；不在目錄裡的 key 回 `404 FEATURE_FLAG_NOT_FOUND`。

**生效值**（`resolveFeatureFlag`）：

```
全平台 off   → 關（緊急開關，蓋過租戶層）
租戶層有值   → 用租戶層
全平台 on    → 開（全面開放；租戶層仍可以個別關掉）
都沒有       → defaultEnabled
```

**判斷**：`FeatureFlagService.isEnabled(key)` 是同步的。租戶層的覆寫隨租戶登記載入 `TenantContext.flags`（`TenantDirectory`），
全平台層快取在 `FeatureFlagService`：切換時本機重新讀取，並經 `core/broadcast`（頻道 `feature_flags`）通知其他程序立即重新讀取；另每 `TENANT_CACHE_TTL` 秒重讀一次，作為漏掉廣播時的上限。
沒有租戶脈絡（平台的工作、平台端點）只看全平台層與預設值；不在目錄裡的 key 一律關。

**用在哪裡**：

- 整支端點：`@RequireFlag('<key>')`（class 或 handler），由 `FeatureGuard` 判斷，關閉時回 `404 FEATURE_DISABLED`（與 `@RequireFeature` 同一個位置與回應，並存時兩者都要成立）。
  平台端點不能標、key 必須在目錄裡，否則路由稽核讓程序啟動失敗（[`backend/05-rbac.md`](./backend/05-rbac.md) §7）。
- 業務分支：`FeatureFlagService.isEnabled('<key>')`；背景工作在租戶脈絡裡執行，同樣看得到租戶層。
- 前端：`/auth/profile` 的 `flags` 列出生效為開的 key。局部 UI 用 `useFlag(key)`；整個 feature 的試行登記進
  `FEATURE_CATALOG` 並宣告 `requires.flag`（[`frontend/02-plugin-system.md`](./frontend/02-plugin-system.md) §7）。
- 變更的推播與 §5.1 相同：租戶層改了發一次 `TENANT_FEATURES_CHANGED`，全平台層改了對每個 `active` 租戶各發一次，前端重新取得 profile。

**移除一個 flag**：① 全平台設 `on`（或把 `defaultEnabled` 改成 `true` 並部署）觀察一段時間 → ② 刪掉 `@RequireFlag`／`isEnabled`／`useFlag`
與舊路徑 → ③ 從 `FEATURE_FLAGS` 刪除。DB 殘留的租戶覆寫在讀取時被忽略，`feature_flag_overrides` 的殘列在同一個 PR 以資料 migration 刪除。
要延期就改 `removeBy`，延期會留在 commit 紀錄裡。

### 5.3 Feature 參數（配額與上限）

決定與理由見 §13。§5.1 的 `features` 決定租戶 **有沒有** 某個 feature；
參數決定開了之後 **能用多少**。由平台管理者在租戶詳情（apps/platform 的「啟用的功能」，每個 feature 那一列下）設定，租戶管理者不能改。
不屬於任何可開關的 feature、對整個租戶生效的限制（`feature: null`，key 以 `rateLimit.` 開頭）列在同一頁的「全租戶的限制」。

**目錄**（`core/tenant/tenant-feature-params.ts` 的 `TENANT_FEATURE_PARAMS`）：每個參數有 `key`（`<feature>.<名稱>`）、所屬的 `feature`（或 `null`）、
`type`（`integer` ｜ `string`）、`defaultValue`、整數的 `min`／`max`／`unit`（`days`、`megabytes`、`count`、`perMinute`）、字串的 `maxLength`／`pattern`。
key 以 `TenantFeatureParamKey` 出現在 OpenAPI。

| key | 預設 | 範圍 | 效果 | 出處 |
| --- | --- | --- | --- | --- |
| `file.storageQuotaMb` | 2048（MB） | 1–10485760 | 租戶的儲存容量：所有檔案與圖片資產（頭像等，[`backend/25-image.md`](./backend/25-image.md) §15.4）的大小合計上限，超過回 `409 FILE_STORAGE_QUOTA_EXCEEDED`；`file` 關掉時照常生效 | [`backend/09-file.md`](./backend/09-file.md) §5.0 |
| `auditLog.hotRetentionDays` | 90（天） | 7–3650 | 稽核熱表保留天數；`auditLog.archive` 搬移早於它的紀錄 | [`backend/06-audit-log.md`](./backend/06-audit-log.md) §7.2、§8 |
| `auditLog.retentionDays` | 365（天） | 365–36500，或 `-1`（永久） | 稽核冷表保留天數；`auditLog.archive` 以 DROP 整個月份分區刪除早於它的紀錄（實際至少保留熱表的天數）。參數的 `foreverValue`（`-1`）不受範圍限制，畫面顯示「永久」 | [`backend/06-audit-log.md`](./backend/06-audit-log.md) §10 |
| `job.maxConcurrency` | 10 | 1–100 | 租戶所有種類的背景工作同時執行的筆數；超過的放回佇列 | [`backend/10-jobs.md`](./backend/10-jobs.md) §3 |
| `identityProvider.maxProviders` | 10 | 1–100 | 外部 IdP 連線數上限，超過回 `409 IDENTITY_PROVIDER_LIMIT_REACHED` | [`04-sso.md`](./04-sso.md) |
| `webhook.maxUrls` | 1 | 1–500 | 整個租戶的 webhook 訂閱裡不重複的網址數；超過而且變多回 `409 WEBHOOK_URL_LIMIT_REACHED` | [`backend/17-webhook.md`](./backend/17-webhook.md) §2.1 |
| `dataTransfer.importMaxRows` | 5000 | 100–20000 | 一次匯入的列數上限；超過時分析回 `422 DATA_TRANSFER_TOO_MANY_ROWS`（不截斷） | [`backend/22-data-transfer.md`](./backend/22-data-transfer.md) §10 |
| `dataTransfer.importMaxSizeMb` | 10（MB） | 1–50 | 分析的檔案大小上限（`413 DATA_TRANSFER_FILE_TOO_LARGE`）；送出套用的請求本體上限是它的兩倍 | 同上 |
| `dataTransfer.exportMaxRows` | 100000 | 1000–1000000 | 一次匯出的列數上限；超過回 `422 DATA_TRANSFER_TOO_MANY_ROWS` | 同上 |
| `gallery.maxItemSizeMb` | 50（MB） | 1–200 | 圖片庫的單檔上限（單次 PUT、不分塊）；超過回 `413 GALLERY_ITEM_TOO_LARGE`，從其他來源加入時略過（`tooLarge`） | [`backend/26-gallery.md`](./backend/26-gallery.md) §4 |
| `rateLimit.authPerMinute`（全租戶） | 1200（次／分） | 60–100000 | 這個租戶登入類請求每分鐘合計的上限，超過回 `429 RATE_LIMITED`；沒覆寫時用環境變數 `AUTH_TENANT_RATE_LIMIT` | [`backend/03-api-conventions.md`](./backend/03-api-conventions.md) §8 |
| `rateLimit.trustedCidrs`（全租戶） | 空（未設定） | 字串，最長 1000，逗號或空白分隔的 CIDR／位址 | 客戶公司或 VPN 的網段：從這些網段登入時 `auth`／`authMail` 的 IP 桶上限 ×10，帳號桶、延遲、鎖定不變 | [`backend/03-api-conventions.md`](./backend/03-api-conventions.md) §8、[`backend/04-auth.md`](./backend/04-auth.md) §12 D5 |

- **讀取**：`tenantFeatureParam(PARAM)` 取目前租戶的生效值（沒有租戶脈絡時拋 `TENANT_NOT_FOUND`）；以 id 找租戶的地方（背景工作佇列）
  用 `resolveTenantFeatureParam(PARAM, record.featureParams)`；腳本讀 `ScriptTenant.featureParams`。覆寫值隨租戶登記載入
  `TenantContext.featureParams`，DB 裡不在目錄裡或驗證不過的值讀取時濾掉（回到預設）。
- **寫入**：`PATCH /platform/tenants/:id` 的 `featureParams` 只列要改的（`{ [key]: value | null }`），`null` 回到預設、等於預設的也不存；
  不認得的 key、型別或範圍不對回 `VALIDATION_FAILED`（`fields["featureParams.<key>"]`）。`PlatformTenant.featureParams` 是目錄上每個參數一項
  （生效值、預設值、`overridden`、範圍與單位）。寫入與平台稽核 `tenant.update`（`before`／`after` 帶 `featureParams`）同一個交易，
  之後 `TenantDirectory.invalidate()`；不推播（參數不影響前端安裝哪些 feature）。
- **與開關無關**：feature 關閉時參數照常保留、照常生效。
- **新增一個參數**：目錄加一列（預設值要讓既有租戶的行為不變，或在 §13 補一條決定說明）→ 擁有者模組以 `tenantFeatureParam()` 讀 →
  apps/platform 的 `TENANT_FEATURE_PARAM_LABEL_KEY`／`TENANT_FEATURE_PARAM_DESCRIPTION_KEY` 與兩個語系檔 → 本節的表。

### 5.4 用量

決定與理由見 §14。平台管理者在 apps/platform 看每個租戶用了多少：租戶清單的用量欄位（可排序），詳情頁的「用量」分頁（摘要、儲存的配額使用率、近 30 天每天一列）。
資料在平台 DB 的 `tenant_usage_daily`：每個租戶每天（UTC 的日曆日）一列，一個量一欄。

| 量 | 欄位 | 來源 | 更新 |
| --- | --- | --- | --- |
| 啟用的使用者／全部使用者 | `users_active`、`users_total` | 租戶 DB 的 `users`（人類、未刪除；啟用 = `status = 'active'`），`modules/user` 登記 | 快照 |
| 服務帳號 | `service_accounts` | 同上，`kind = 'service'` | 快照 |
| 已用的儲存量、配額 | `storage_used_bytes`、`storage_quota_bytes` | `file_storage_usage.used_bytes`（與上傳時判斷配額的是同一個數字，§13.3 D8）、`file.storageQuotaMb`，`modules/file` 登記 | 快照 |
| 最後登入 | `last_login_at` | 人類使用者的 `max(last_login_at)` | 快照 |
| 後台／對外 API 的請求數 | `requests_internal`、`requests_external` | 每個請求（含被 guard 擋下的；健康檢查不算），依程序是內部 api 或對外 API | 計數 |
| 背景工作數 | `jobs_executed` | 租戶的工作在租戶裡開始執行一次記一次（重試也算） | 計數 |

- **快照**：平台工作 `tenant.usageRollup`（`TENANT_USAGE_ROLLUP_CRON`，預設每小時第 5 分）走遍每個 `active` 租戶，
  呼叫擁有者模組登記的來源（`core/usage` 的 `TenantUsageSnapshots`，在 `onModuleInit` 登記），覆寫當天那一列的快照欄。歷史日的值是那天最後一次快照；
  一個租戶失敗只略過它。同一個工作最後刪掉保留期限（`TENANT_USAGE_RETENTION_DAYS`，預設 400 天）以前的列。
- **計數**：`core/usage` 的 `UsageMeter` 在每個程序的記憶體依「日期 × 租戶」累計，每分鐘一條 `INSERT … ON CONFLICT DO UPDATE SET x = x + excluded.x`
  加到當天的列，程序結束前再寫一次。多個程序（內部 api、對外 API、worker）同時寫入天然相加。請求由 `UsageRequestMiddleware` 計，
  掛在租戶的 middleware（`TenantMiddleware`／`TokenTenantMiddleware`）之後；背景工作在 `JobQueue` 進入租戶之後計。寫入失敗記
  `api_tenant_usage_flush_failures_total`，那一輪的計數丟掉。
- **摘要**（清單的每一列與詳情頁的上方）：最近一次快照的量、儲存使用率（已用 ÷ 配額，可能超過 1）、近 7 天（含今天）的請求數、
  最後活動（最後登入與最後一個有對外 API 請求的日子，取較晚者）。還沒彙總過的租戶，快照的量是 `null`，畫面顯示「-」。
- **配額警示**：使用率達到 80% 時清單與詳情標成警示；彙總時越過 80%（上一次快照低於、或第一次就高於）發平台通知
  `tenant.storageNearQuota` 給角色有 `tenant:update` 的平台管理者，停在 80% 以上不重發，降回去之後再越過會再發。
- **API**：`GET /platform/tenants` 每一列多一個 `usage`（`TenantUsageSummary`），回應多 `usageRecentDays`、`usageWarningRatio`，
  `sort` 可用 `createdAt`、`code`、`usersActive`、`storageUsage`、`recentRequests`、`lastActivityAt`（沒帶時依建立時間舊到新）；
  `GET /platform/tenants/:id/usage?days=30`（1–90）回摘要與每天一筆（含沒有資料的日子）。都只要 `tenant:read`。
- 租戶管理者在 backstage 看不到這些數字（§14.2 D9）。
- **儲存的止水線**：所有租戶的已用量合計另由平台每 5 分鐘量一次（`storage.totalRollup`，平台 DB 的 `tenant_storage_usage`），
  超過 `STORAGE_TOTAL_LIMIT_MB` 時全部租戶停止新的上傳（`409 STORAGE_TOTAL_LIMIT_REACHED`）；每個租戶的容量照舊。
  租戶清單上方顯示合計與止水線（`GET /platform/tenants/storage-total`）。見 [`backend/25-image.md`](./backend/25-image.md) §12、D8。

## 6. 周邊元件怎麼分租戶

| 元件 | 做法 | 詳見 |
| --- | --- | --- |
| 背景工作 | 佇列在平台 DB；信封 `{ tenantId, payload }`，handler 在那個租戶裡執行。交易內入列寫租戶 DB 的 `job_outbox`，提交後搬進佇列。排程觸發的租戶工作展開成每個 `active` 租戶一筆。租戶已刪除或停用時略過；`maintenance` 交給重試 | [`backend/10-jobs.md`](./backend/10-jobs.md) |
| 權限／使用者快取 | key 是 `{tenantId}:{userId}`；關係圖寫入後整個租戶的權限快取失效，以 `{ tenant, revision }` 在平台 DB 廣播給其他程序（租戶 DB 各自的 `NOTIFY` 送不到別的 database）；使用者快取的失效以 `{ tenant, users }` 廣播 | [`backend/05-rbac.md`](./backend/05-rbac.md) §5、[`01-system.md`](./01-system.md) §4.4 |
| 即時推播 | room 帶租戶：`t:{tenantId}:perm:{key}`、`t:{tenantId}:user:{id}`、`t:{tenantId}`；Origin 同源（租戶自己的網域）一律允許 | [`backend/08-realtime.md`](./backend/08-realtime.md) §6、§11 |
| 物件儲存 | 每個租戶一個 bucket（`tenants.storage_bucket`）；presigned URL 以 `FILE_STORAGE_PUBLIC_ENDPOINT` 的 `{tenantOrigin}` 簽成租戶自己網域的 `/storage` | [`backend/09-file.md`](./backend/09-file.md) §3、§3.1 |
| 寄信 | 產品頁面的連結用租戶的主要網域（找不到就拋錯重試）；帳號流程的連結在 apps/platform、帶 `?tenant=` | [`backend/11-mail.md`](./backend/11-mail.md) |
| 稽核 | 租戶內的動作寫租戶的 `audit_logs`；平台管理者的動作寫 `platform_audit_logs`，兩邊互相看不到 | [`backend/06-audit-log.md`](./backend/06-audit-log.md) |
| 外部 IdP | 連線在租戶 DB，由租戶的管理者在 backstage 設定；平台只有開關（§5.1） | [`04-sso.md`](./04-sso.md) |
| 可啟用的 feature、feature flag | 平台 DB 的 `tenants.features`、`tenants.flags` 與 `feature_flag_overrides`；api 以全域的 `FeatureGuard` 擋下未啟用的端點 | §5.1、§5.2 |
| 領域事件 | 在發佈者的租戶脈絡裡傳給訂閱者；`TENANT_ACTIVATED` 讓每個租戶一份的初始資料在佈建、重新啟用時補上 | `core/events` |
| Access token | 帶 `tid`（租戶）或 `realm: 'platform'`；拿到別的網域一律無效 | [`backend/04-auth.md`](./backend/04-auth.md) |
| 用量 | 平台 DB 的 `tenant_usage_daily` 依租戶一天一列；指標（Prometheus）不帶租戶，依租戶的數字只看這張表 | §5.4 |

## 7. 部署

- **DNS 與 TLS**：租戶的預設網域是 `{code}.<TENANT_BASE_DOMAIN>`，所以 `*.<TENANT_BASE_DOMAIN>` 要有 wildcard DNS 與
  wildcard 憑證（TLS 由前面的 LB／ingress 終結）。客戶自己的網域要另外設 DNS 與憑證，再由平台管理者加到租戶上。
- **反向代理**：backstage 的 nginx 是 `server_name _`，任何網域都由它服務，並把 `Host`（含 port）原樣轉給 api 與
  file-storage（`deploy/nginx.conf`）。apps/platform 是另一個 origin（`deploy/nginx.platform.conf`）。
- **同源**：每個租戶的頁面、`/api`、`/storage`、WebSocket 都在自己的網域，CSP 維持 `connect-src 'self'`。
- **單一 api 執行個體**：租戶狀態的變更（停用、網域）經廣播在每個程序立即生效（漏掉時最多晚 `TENANT_CACHE_TTL` 秒）；
  其他程序寫入的推播經事件轉送送到每個程序（[`backend/08-realtime.md`](./backend/08-realtime.md) §7.6）。擴成多個執行個體的前提見 [`01-system.md`](./01-system.md) §4.3。
- **備份與還原**：平台 DB 與每個租戶的 database 各自 `pg_dump`，DB 角色另外一份（租戶角色的密碼只存在加密的連線字串裡），
  每個租戶可以單獨還原；`TENANT_SECRET_KEY` 與資料備份分開保存。步驟見 [`01-system.md`](./01-system.md) §4.5。

| 環境變數 | 用途 |
| --- | --- |
| `PLATFORM_DATABASE_URL` | 平台 DB |
| `TENANT_SECRET_KEY` | 加密租戶連線字串（production 必填；開發時由 `JWT_SECRET` 推導） |
| `TENANT_POOL_MAX`、`TENANT_POOL_IDLE_TIMEOUT`、`TENANT_CACHE_TTL` | 每個租戶的連線池上限、閒置連線關閉的秒數、租戶登記的快取秒數 |
| `TENANT_PROVISIONING_DATABASE_URL` | 佈建新租戶用（`CREATEDB`＋`CREATEROLE`）；留空用 `PLATFORM_DATABASE_URL` |
| `TENANT_BASE_DOMAIN` | 新租戶預設網域的上層；留空用 `APP_PUBLIC_URL` 的 host（開發：`acme.localhost:5173`） |
| `DEFAULT_TENANT_CODE`／`NAME`／`DATABASE_URL`／`DOMAINS`／`STORAGE_BUCKET` | `db:migrate` 在平台 DB 還沒有租戶時登記的預設租戶 |
| `PLATFORM_ADMIN_EMAIL`、`PLATFORM_ADMIN_PASSWORD` | `db:seed` 建立的第一位平台管理者（`super-admin`） |
| `SEED_TENANT` | `db:seed` 建立 `SUPER_ADMIN_EMAIL` 的租戶、`db:seed:dev`／`e2e` 的目標租戶（預設 `default`） |
| `FILE_STORAGE_PUBLIC_ENDPOINT` | 預設 `{tenantOrigin}/storage`；真正的 S3 填固定網址 |

### 7.1 DB 角色：api 不用超級使用者

`docker-compose.prod.yml` 的 postgres 在 **第一次初始化資料目錄** 時執行 `deploy/postgres/10-roles.sh`，建立三個角色；
api 與 migrate 都不再以 `POSTGRES_USER`（超級使用者）連線：

| 角色 | 權限 | 用在 | 密碼（compose 變數） |
| --- | --- | --- | --- |
| `b2b_platform` | 擁有平台 DB（含 pg-boss 的 schema） | api、migrate 的 `PLATFORM_DATABASE_URL` | `POSTGRES_PLATFORM_PASSWORD` |
| `b2b_tenant_default` | 擁有預設租戶的 DB（`POSTGRES_DB`） | `DEFAULT_TENANT_DATABASE_URL`：與佈建出來的租戶同一種模式（角色擁有自己的 DB，別人連不進來） | `POSTGRES_TENANT_PASSWORD` |
| `b2b_provisioner` | `CREATEDB`、`CREATEROLE`，**不是** 超級使用者；`createrole_self_grant = 'set, inherit'` | `TENANT_PROVISIONING_DATABASE_URL`（佈建）、`pnpm db:drop-tenant` | `POSTGRES_PROVISIONER_PASSWORD` |

- 每個 database 都 `REVOKE ALL … FROM PUBLIC`：一個角色的密碼外洩只碰得到自己的 database。
- `createrole_self_grant` 讓佈建角色取得它建立的租戶角色的 `SET`，`CREATE DATABASE … OWNER <租戶角色>` 與
  `DROP DATABASE … WITH (FORCE)` 才能在非超級使用者下執行（PG 16 起的規則）。
- 密碼會放進連線字串，請用 URL 安全的字元（例：`openssl rand -hex 24`）。
- **既有部署**（資料目錄已初始化過，腳本不會再跑）：以超級使用者手動執行 `10-roles.sh` 裡的 SQL（`CREATE DATABASE` 那一行
  改成 `ALTER DATABASE <平台 DB> OWNER TO b2b_platform`），再把兩個 database 裡的物件交給新角色
  （在各 database 執行 `REASSIGN OWNED BY <POSTGRES_USER> TO <角色>`），最後在平台 DB 以新的連線字串更新預設租戶的
  `tenants.database_url_encrypted`（以 `TENANT_SECRET_KEY` 加密）。沒切換之前保留舊的 compose 設定即可，兩者可以並存。

## 8. 腳本

| 指令 | 範圍 |
| --- | --- |
| `pnpm db:migrate [--strict]` | 平台 DB ＋ 每個未刪除、不是佈建中或佈建失敗的租戶；平台 DB **一個租戶都沒有（含已刪除的）** 時登記預設租戶，所以預設租戶被刪除後不會再被登記回來。production 執行時在平台 DB 寫入環境標記（`platform_environment`） |
| `pnpm db:seed [--strict]` | 第一位平台管理者；每個 `active`、`disabled` 租戶補權限目錄與系統角色；`SUPER_ADMIN_EMAIL` 只建在 `SEED_TENANT`。結束碼的規則同 `db:migrate`：單一租戶失敗只列出來 |
| `pnpm db:seed:dev`、`db:seed:e2e` | `SEED_TENANT` 一個租戶（寫入前的防呆同 `db:reset`） |
| `pnpm db:reset` | 清空平台 DB 的協定狀態與 session，以及每個租戶的業務資料。拒絕標記為 production 的平台 DB；不在本機的 DB 要加 `--confirm <平台 database 名稱>`（[`backend/02-database.md`](./backend/02-database.md) §6.1） |
| `pnpm db:archive-audit-logs` | 每個 `active` 租戶的稽核冷熱搬移 |
| `pnpm db:drop-tenant` | §5 的清除。`db:migrate` 登記的租戶（預設租戶）刪除後，database 不是佈建產生的：要另外加 `--database <名稱>` 確認，只 DROP DATABASE、不刪共用的 DB 角色 |

## 9. 測試

| 層 | 涵蓋 |
| --- | --- |
| 單元 | `Tenancy`（狀態、版本檢查與重新檢查、`runForMaintenance`、`evict`）、`JobQueue` 對租戶不能進入的處理、`S3ObjectStorage` 的每租戶 bucket 與 presigned 網域、`MailService` 的租戶網域、`FeatureGuard`（含 `@RequireFlag`）、`PlatformTenantService.update` 的 `features` 與 `flags`（稽核、失效後發佈事件）、`FeatureFlagService` 的生效值、`PlatformFeatureFlagService`、flag 目錄的格式與到期、`UsageMeter`（依日期與租戶合併、失敗不重送）、`UsageRequestMiddleware`、越過警示門檻與最後活動的判斷 |
| 整合（`apps/api/test`） | `tenancy.spec.ts`（兩個租戶的帳號、token、資料互不相通；未知網域、停用、migration 落後）、`platform-tenant.spec.ts`（建立 → 佈建 → 啟用信 → 登入；網域；停用清掉 IdP 的 session；刪除後網域釋出）、`platform-admin.spec.ts`（平台管理者、稽核、背景工作、外部 IdP 開關、關掉 `file` 後 `/files` 回 404 `FEATURE_DISABLED` 與 profile 的 `features`）、`feature-flags.spec.ts`（兩級覆寫的生效值、`@RequireFlag` 端點、權限與稽核）、`tenant-usage.spec.ts`（請求計數相加、快照與租戶 DB 一致、配額警示只在越過時通知、清單依用量排序、保留期限）、`route-audit.spec.ts`（`@RequireFeature` 標在哪些端點）、`sso.spec.ts`（OIDC 帶租戶） |
| E2E（`apps/e2e/tests/tenancy.spec.ts`） | 平台管理者在 apps/platform 建立租戶，第一位管理員從啟用信進入 `{code}.localhost:5173`；同一個 IdP session 換租戶要重新登入；授權碼送到別的租戶的 BFF → `AUTH_SSO_CODE_INVALID`；authorize 的租戶與 redirect URI 不一致 → `invalid_request`、沒有授權碼；停用後網域 503 |
| E2E（`apps/e2e/tests/platform-tenant.spec.ts`） | 加別名網域 → 從那個網域解析得到租戶 → 移除後 `TENANT_NOT_FOUND`，兩次都記入平台稽核；主要網域沒有移除按鈕；用量分頁的統計卡與 30 天趨勢、列表依用量排序 |

HTTP 整合測試一律以 `listenOnLoopback(app)` 取得 server（[`../coding-standards/04-testing.md`](../coding-standards/04-testing.md) §3）。
E2E 會 `db:reset`：跑之前一定要帶暫用 DB 的 `PLATFORM_DATABASE_URL`、`DEFAULT_TENANT_*`。沒有帶（環境變數與 `.env` 的相同）時 global setup 拒絕執行，
要清空 `.env` 那一個得明確加 `E2E_RESET_CONFIRM=<平台 database 名稱>`（[`frontend/10-testing.md`](./frontend/10-testing.md) §4.3）。

## 10. 設計決策：租戶實體隔離（每個租戶一個 database 與網域）

> 原 ADR-0020，2026-09-29 決定，2026-09-30 完成實作。整份取代 §10.7（見 §10.7），並修改 [`04-sso.md`](./04-sso.md) §12（[`architecture/04-sso.md`](04-sso.md) §12）的 D1、D9、D12、D13。

### 10.1 背景

§10.7 以「共用資料表 ＋ `workspace_id`、應用層強制」做工作區，[`architecture/04-sso.md`](04-sso.md) §12 讓帳號跨工作區共用、工作區由路由前綴帶。
實際的產品要求改變了：

1. **租戶要實體硬切分**：每個租戶有自己的資料庫與網域；一個查詢忘了帶條件就跨租戶，這種風險不能接受。
2. **backstage 不該看見租戶的切分**：backstage 是「某個租戶的後台」，仍以「使用者」為核心；沒有成員、沒有 `/w/:slug`、沒有切換器。
3. **平台管理者與租戶管理者是兩份資料**：`apps/platform` 的管理者管租戶；backstage 的管理者只存在於各自的租戶。
4. **租戶的進出由 `apps/platform` 負責**：從 backstage 登入時帶著租戶到 apps/platform；在 apps/platform 以租戶登入後，自動登入該租戶的 backstage。

§10.7 的 D2–D5、D8–D18 都建立在「同一個資料庫、同一份帳號」上，所以這份決定整份取代它，而不是修改。

延續 [`backend/04-auth.md`](backend/04-auth.md) §10（app session 不變）、[`iam/01-model.md`](iam/01-model.md) §8（租戶內回到扁平權限）。

### 10.2 決定

**隔離層級**

| 方案 | 結論 |
| --- | --- |
| A. 共用資料表 ＋ `workspace_id`（§10.7） | 不採用：隔離靠應用層與測試；不符合「硬切分」 |
| B. 每租戶一個 schema，以 `search_path` 切換 | 不採用：同一個 database 內權限與連線共用，`search_path` 設錯一次就讀到別人的表；備份、還原、刪除都無法單獨對一個租戶做 |
| **C. 同一個 Postgres 叢集、每租戶一個 database，api 依網域路由到對應的連線池** | **採用**：database 之間在 Postgres 層級無法互相查詢；可以單獨備份、還原、搬到別的叢集、`DROP DATABASE`；api 仍是單一程序 |
| D. 每租戶一整套部署（api ＋ DB） | 延後：維運成本隨租戶數線性成長。C 的設計讓單一租戶之後可以被搬出去（換掉連線設定即可） |

**身分**

| 方案 | 結論 |
| --- | --- |
| A. 帳號集中在平台 DB，租戶 DB 只存使用者資料與角色 | 不採用：身分資料不在租戶的 database 裡，就不是硬切分；租戶刪除時帳號還留在平台 |
| **B. 帳號存在各租戶 DB；平台 DB 只有平台管理者** | **採用**：同一個 email 在兩個租戶是兩個互不相干的帳號（各自的密碼、狀態、外部身分連結） |

**具體決定**

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **兩種資料庫**：**平台 DB**（一個）存平台管理者、平台角色、租戶登記、平台稽核、IdP 的協定狀態（`oidc_payloads`）、背景工作佇列；**租戶 DB**（每租戶一個）存現在除了這些以外的所有表（`users`、`roles`、`files`、`audit_logs`、`approval_requests`、`refresh_tokens`、`identity_providers`…）。兩者是 **兩套 Drizzle schema、兩條 migration 線**（平台：`db/platform/`；租戶沿用 `db/schema/`、`db/migrations/`） | 平台 DB 只有「租戶之外」的東西；租戶 DB 是完整的一份業務資料，可以單獨搬走 |
| D2 | **租戶由網域決定**：每個租戶登記一到多個 backstage 網域（`tenants.domains`，例：`acme.backstage.example.com`，或客戶自己的網域）。api 以反向代理傳來的 Host 查租戶登記（快取），放進 `AsyncLocalStorage` 的請求脈絡；找不到租戶的 Host，需要租戶的路由一律 404（`TENANT_NOT_FOUND`），健康檢查等不需要租戶的路由照常。apps/platform 的網域不屬於任何租戶 | 網域就是租戶的邊界，backstage 前端完全不必知道租戶；cookie 本來就是 host-only（[`architecture/04-sso.md`](04-sso.md) §12.2 D6），不同租戶的 app session 天然分開 |
| D3 | **連線池依租戶建立**：`Tenancy` 在第一次需要時為該租戶建立小型連線池（`max` 小、閒置連線關閉）；repository 注入的 `TENANT_DB` 是一個 Proxy，每次存取都轉到 **目前租戶** 的 `db`，沒有租戶脈絡時拋 `TENANT_NOT_FOUND`（不會退回任何預設 DB）。平台的 repository 注入另一個 token `PLATFORM_DB` | 不用 Nest 的 REQUEST scope（整條 DI 鏈每個請求重建）；沒有脈絡就拋錯，比「靜默用錯 DB」安全。連線數過多時再加 PgBouncer |
| D4 | **每個租戶有自己的 DB 角色與密碼**：租戶的 **完整連線字串** 以主金鑰（沿用 [`architecture/04-sso.md`](04-sso.md) §12.2 D11 的 AES-GCM，另一把 `TENANT_SECRET_KEY`）加密存在 `tenants.database_url_encrypted`；租戶的 DB 角色只能連自己的 database。建立 database 用另一個有 `CREATEDB` 的佈建角色，只在佈建時使用 | 連線字串外洩只影響一個租戶；api 平常持有的連線沒有能力碰別的租戶 |
| D5 | **平台管理者與租戶使用者是兩份資料**：平台 DB 的 `platform_admins`（加上平台自己的角色與權限，範圍很小：`tenant:*`、`platformAdmin:*`、`platformAuditLog:read`、`job:*`）；租戶 DB 的 `users`／`roles`／`permissions` 回到 [`iam/01-model.md`](iam/01-model.md) §8 的扁平模型，**沒有 `scope`、沒有成員表** | 兩邊的權限目錄不重疊，就不需要 §10.7 D2 的範圍檢查與 route-audit 規則。super-admin 也分兩種：平台的 super-admin 看不到任何租戶的內容（要看就得在該租戶有帳號） |
| D6 | **OIDC 仍是單一 issuer**（`apps/platform` origin 的 `/api/oidc`），`accountId` 帶上身分所屬：租戶帳號是 `t:{tenantId}:{userId}`、平台管理者是 `p:{adminId}`；ID token 與授權碼帶 `tenant` claim | 一個 issuer 就只有一組 JWKS、一個互動頁；帳號 id 帶前綴就不會把 A 租戶的 user id 誤當成 B 租戶的 |
| D7 | **authorize 請求帶租戶**：backstage 從自己的網域知道租戶，跳轉時帶額外參數 `tenant={code}`；provider 檢查 `redirect_uri` 的 origin 屬於這個租戶的網域（不一致回協定錯誤）。沒有 `tenant` 參數的授權只給 client `auth`，身分是平台管理者 | 使用者要求「從 backstage 跳到 auth 時攜帶租戶資訊」；只信參數會讓人把 A 的授權碼導到 B 的網域，所以以 redirect URI 交叉驗證 |
| D8 | **登入互動依租戶選資料來源**：互動頁顯示租戶名稱；密碼、外部 IdP、只允許 SSO 的網域都查 **該租戶的 DB**。沒有租戶時對平台 DB 驗證平台管理者 | 符合「沒有帶租戶就用 auth 管理者的資訊」 |
| D9 | **IdP session 一次只屬於一個身分**：session 的帳號租戶與這次授權要求的租戶不同時，強制重新登入（自訂互動 policy）；登入後 session 換成新的身分。各租戶 backstage 的 app session 是各自網域的 cookie，所以 **同時開兩個租戶的 backstage 仍然可以**，只是第二個要再登入一次 | 不能讓 A 租戶的 IdP session 直接換到 B 租戶的授權碼；「同一個人」在兩個租戶本來就是兩個帳號（身分 B） |
| D10 | **BFF 兌換時再檢查一次租戶**：`/api/auth/sso/callback` 以 Host 解出的租戶，必須等於授權碼上帳號的租戶，否則 `AUTH_SSO_CODE_INVALID`。**access token 帶 `tid`**，驗證時必須等於請求網域的租戶 | 第二道防線：即使 provider 的檢查有漏洞，授權碼也換不到別的租戶的 session；A 租戶簽的 token 拿到 B 租戶的網域也用不了 |
| D11 | **在 apps/platform 切換租戶 = 前往該租戶的 backstage 登入**：apps/platform 的「進入租戶」頁讓使用者輸入租戶代碼（或從 `?tenant=` 帶入），查到租戶後頂層跳轉到該租戶網域的 `/auth/login`，之後走一般的授權流程（D7–D10），完成後落在該租戶的 backstage。apps/platform **不列出** 一個人屬於哪些租戶 | 使用者要求「跳轉工作區必須在 auth 中」且以租戶代碼選擇；帳號分散在各租戶 DB，列出所屬租戶需要跨租戶掃描或在平台留索引，兩者都破壞硬切分 |
| D12 | **租戶佈建**：平台管理者在 apps/platform 建立租戶（代碼、名稱、網域、第一位管理員的 email）→ api 建立 DB 角色與 database、跑租戶 migration、seed 權限目錄與系統角色、建立第一位管理員（寄啟用信，連結帶租戶）→ 租戶狀態 `provisioning` → `active`；失敗停在 `failed`，可重試。佈建是背景工作 | 建立 database 不能包在一般交易裡，且可能耗時；狀態機讓失敗可以重試、可以看見 |
| D13 | **停用與刪除**：停用 = 該租戶的網域回 503、撤銷所有 session；刪除 = 標記刪除並停用，`DROP DATABASE` 是另一個需要確認的手動動作（腳本），不在管理頁一鍵完成 | 硬切分的好處之一是可以真的刪乾淨，但不可逆的動作不該是一個按鈕 |
| D14 | **migration 一律跑遍所有租戶**：`pnpm db:migrate` 先跑平台，再依序跑每個未刪除、而且不是佈建中或佈建失敗的租戶（那兩種由佈建負責）；單一租戶失敗不影響其他租戶，結束時列出失敗的租戶。只有平台 DB 失敗才以非零結束（部署時 api 依賴 migrate 成功結束；`--strict` 給 CI）。`db:seed` 同樣逐一處理租戶。應用程式啟動時檢查每個租戶的 migration 版本，落後的租戶標成不可用（503），不阻止整個程序啟動 | 一個租戶壞掉不該讓所有租戶停擺；但也不能讓舊 schema 的租戶收到新程式的請求 |
| D15 | **背景工作佇列在平台 DB**，資料是信封 `{ tenantId, payload }`，handler 在該租戶的脈絡裡執行；payload 只放 id，不放租戶的個人資料。排程觸發的租戶工作沒有 `tenantId`，worker 收到時 **展開** 成每個 `active` 租戶一筆；只碰平台 DB 的工作（`oidc.cleanup`）宣告成 `scope: 'platform'`。**交易內的入列寫租戶 DB 的 `job_outbox`**，提交後立刻搬進佇列，定期的 `jobs.outboxSweep`（預設每 10 分鐘）補搬程序當掉時沒搬成的；outbox 的 id 就是工作 id，重搬也只有一筆 | 每個租戶一套 pg-boss 等於 N 組輪詢；payload 只放 id 則平台 DB 不會存到租戶的內容。平台 DB 的佇列不能和租戶 DB 的業務寫入在同一個交易，outbox 保住 [`backend/10-jobs.md`](backend/10-jobs.md) §9.2 D2「資料與工作一起提交或一起回滾」 |
| D16 | **物件儲存每租戶一個 bucket**（`tenants.storage_bucket`，佈建時建立），`ObjectStorage` 依目前租戶選 bucket；沒有租戶脈絡時拋錯，不退回共用的 bucket | 與 database 同一個隔離層級；刪除租戶時整個 bucket 可以清掉 |
| D17 | **快取與推播加上租戶前綴**：權限快取、使用者快取的 key 是 `{tenantId}:{userId}`；Socket.io 的連線從租戶網域進來、屬於那個租戶，權限的 room 名稱是 `t:{tenantId}:perm:{key}`（租戶取自目前的脈絡）；使用者與 IdP session 的 room 用全域唯一的 id，不另外帶租戶 | 單一程序服務所有租戶時，記憶體裡的東西仍是共用的 |
| D18 | **外部 IdP 連線屬於租戶**：`identity_providers`、`identity_provider_domains`、`user_identities` 在租戶 DB；home realm discovery 只在該租戶內進行。外部 IdP 的固定 callback 以 `state` 找回登入狀態（在平台 DB 的 `oidc_payloads`），裡面帶租戶 | 客戶用自己的 Azure AD 是租戶層級的設定；一個網域在不同租戶可以對應不同連線 |
| D19 | **稽核分兩處**：租戶內的動作寫該租戶的 `audit_logs`；平台管理者的動作（租戶建立、停用、佈建結果、平台管理者登入）寫平台 DB 的 `platform_audit_logs`。平台管理者看不到租戶的稽核 | 租戶的稽核是租戶的資料；平台只記錄自己做過什麼 |
| D20 | **既有的工作區實作整個移除**，不遷移成租戶：現有資料（Phase 0 的開發資料）做成第一個租戶 `default` 的 database，migration 線重新起一個基準點（平台、租戶各一個 baseline） | 工作區的表、`scope`、成員、邀請在新模型裡都沒有對應；還沒有正式環境資料，寫反向 migration 沒有價值 |
| D21 | **migration 重新建立基準點**：平台與租戶各一條 migration 線，各自從 baseline 起算；已有需要保留的環境時，寫一支一次性的搬移腳本，而不是保留舊的 migration 線 | 還沒有正式環境資料；舊線上充滿工作區的欄位與表，保留只會讓每個新租戶多跑一段沒有意義的歷史 |
| D22 | **外部 IdP 連線由租戶的管理者在自己的 backstage 設定**（資料在租戶 DB）；平台管理者只能開關「是否允許這個租戶使用外部 IdP」（`tenants.allow_external_idp`；後由 §12.2 D2 併進 `tenants.features` 的 `identityProvider`） | 連線的細節（client secret、網域）是租戶的資料，平台看不到；平台保留的是「能不能用」這個層級的決定 |
| D23 | **背景工作的監控**：apps/platform 有全平台的監控頁（所有租戶與平台自己的工作，`platformJob:*`）；backstage 的 `/job` 只看自己租戶的工作 | 佇列在平台 DB，全平台的樣子只有平台該看；租戶的管理者仍需要看自己的寄信、匯出是否卡住（見「實作時改掉的做法」） |
| D24 | **租戶的網域**：`tenant_domains` 支援多個網域，第一個是主要網域；建立時產生 `{code}.<TENANT_BASE_DOMAIN>`，客戶自己的網域由平台管理者加入（DNS 與 TLS 由部署處理） | 預設網域讓建立租戶不必等 DNS；自訂網域是少數客戶的需求，手動處理就夠 |
| D25 | **平台管理者的 app session** 在 apps/platform 的 origin，結構同租戶的 `refresh_tokens`（平台 DB 的 `platform_refresh_tokens`），輪替規則共用 | 同一套已驗證過的規則（[`backend/04-auth.md`](backend/04-auth.md) §10），只是資料在平台 DB |
| D26 | **apps/platform 的帳號流程以網址參數 `?tenant=` 指定租戶**，頁面以 `X-Tenant` 標頭送給 api（只在 apps/platform 的網域有效）；token 在租戶 DB，以參數選 DB，查不到一律視為無效。沒有 `?tenant=` 的 `/setup`、`/reset-password` 是平台管理者的帳號 | 帳號流程的頁面只有一份（apps/platform），不必在每個租戶網域上各放一份；不區分「租戶不存在」與「token 無效」，不洩漏租戶是否存在 |

### 10.3 流程

以下是決定當時的流程（現行流程見 §2、[`04-sso.md`](./04-sso.md) §3）。

**從 backstage 登入**

```
使用者        acme.backstage（RP）             apps/platform                   apps/api
  │ 打開 acme 網域 │                             │                           │ Host → tenant acme
  │─────────────▶│ 沒有 session                  │                           │
  │              │── 302 /api/oidc/auth?client_id=backstage&tenant=acme&redirect_uri=https://acme…/auth/callback ─▶│
  │              │                             │                           │ redirect_uri ∈ acme 的網域？
  │              │                             │◀── 互動頁（顯示「Acme」） │ IdP session 是別的租戶 → 要求登入
  │  email／密碼（查 acme 的 DB）               │── POST …/login ─────────▶│
  │ 頂層跳轉 resume → 303 https://acme…/auth/callback?code ─────────────────────────────│
  │              │── POST /api/auth/sso/callback（Host = acme）─────────────────────────▶│ code 的租戶 == acme？
  │              │◀── access token ＋ acme 網域的 refresh cookie ──────────────────────│
```

**在 apps/platform 進入租戶**

```
platform /tenant?tenant=acme（或手動輸入代碼）
  └─ GET /api/tenants/lookup?code=acme → { name, loginUrl: https://acme…/auth/login }（公開，只回登入入口）
  └─ 頂層跳轉 → acme 的 /auth/login → 同上的授權流程 → 落在 acme 的 backstage
```

**平台管理者**

```
platform /login（沒有 tenant）→ 授權（client auth、無 tenant 參數）→ 互動頁查平台 DB → platform 的管理頁（租戶、平台管理者、背景工作）
```

### 10.4 代價

| 代價 | 評估 |
| --- | --- |
| 每個租戶一組連線池，租戶多時連線數上升 | 池子小且閒置關閉；超過數十個活躍租戶時前面加 PgBouncer（transaction mode） |
| migration 要跑 N 次、會出現「部分租戶升級失敗」 | D14：逐一執行、失敗的租戶單獨標成不可用並可重跑 |
| 同一個人在多個租戶要記多組密碼、登入多次 | 硬切分的直接結果；客戶可以用外部 IdP（D18）讓它變成一次點擊 |
| 平台管理者無法直接協助租戶內的問題 | 刻意的設計；需要時由租戶管理者建立帳號給支援人員，並留下該租戶的稽核 |
| 跨租戶的報表、搜尋做不到 | 需要時另建資料倉儲，從各租戶匯出；不在線上系統做 |
| 開發環境要處理多個網域 | 用 `*.localhost`（瀏覽器與 Node 都解析到 loopback），seed 建兩個租戶 |
| 已經完成的工作區實作（§10.7 第一批與邀請）要移除 | 沉沒成本；繼續留著會讓兩套隔離模型並存 |

### 10.5 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| 保留 §10.7，再加 Postgres RLS | 仍是同一個 database 與同一份帳號；不滿足「獨立的資料庫與網域」與「兩份管理者資料」 |
| 每個租戶一個 issuer（每租戶一個 `oidc-provider` 實例） | 每個租戶一組 JWKS、一個互動路徑；單一 issuer 加上帶租戶的 `accountId` 與 D7、D10 的檢查已經足夠隔離 |
| apps/platform 登入後列出「你屬於的租戶」 | 需要跨租戶以 email 掃描，或在平台 DB 保留 email → 租戶的索引；兩者都讓平台知道租戶的使用者名單 |

### 10.6 實作紀錄：實作時改掉的做法

| 原本的構想 | 改成 | 理由 |
| --- | --- | --- |
| `TenantDb` 服務，repository 呼叫 `tenantDb.current()` 取 db（D3） | `TENANT_DB` 是 Proxy，repository 照常把它當 `Database` 用 | 29 個 repository／service 只換注入的 token；Proxy 對 DI 與生命週期 hook 的探測（`then`、`onModuleInit`…）直接回 undefined，其餘存取一律要有租戶脈絡 |
| 連線池有 LRU 上限（D3） | 不回收連線池物件，閒置的連線由 postgres.js 的 `idle_timeout` 關閉 | 回收正在被使用的連線池會讓執行中的查詢失敗；連線池物件本身很便宜，佔資源的是連線 |
| `tenants` 存 DB 角色與加密的密碼（D4） | 存加密的完整連線字串 | 換叢集、換主機、換角色都只改一欄；佈建時仍為每個租戶建立自己的角色（第 4 步） |
| 快取與推播的租戶前綴在第 5 步做（D17） | 第 2 步就做，並加上 access token 的 `tid`（D10） | 整合測試發現：A 租戶簽的 token 拿到 B 租戶的網域時，以 userId 為 key 的快取會拿 A 的使用者與權限判斷 B 的請求（跨租戶提權） |
| 佇列在平台 DB，交易內入列照舊（D15） | 交易內入列改寫租戶 DB 的 outbox | 平台 DB 與租戶 DB 不能在同一個交易 |
| IdP session 換身分時「登入後 session 換成新的身分」（D9） | 在 `realm_mismatch` check 裡先把舊身分從 session 拿掉（清帳號與 grant、換新的 `uid`）再要求登入 | oidc-provider 在「已登入的 session 換成另一個帳號」時會先把舊 session 登出（`end_session_confirm`），觸發單一登出、連帶登出另一個租戶開著的 backstage；而且 `uid` 不變，兩個租戶的 app session 會綁在同一個 IdP session 上 |
| 平台管理者有自己的權限目錄與角色（D5） | 第 3 步只有登入與個人資料；權限目錄隨第 4 步的租戶管理一起加入 | 第 3 步還沒有任何需要權限的平台端點 |
| 版本不符的租戶標成不可用（D14） | 只有 **落後** 的租戶不可用；DB 比程式新照常服務。落後的租戶每 30 秒重新檢查 | 滾動部署時舊的執行個體會看到較新的 DB；要求 migration 對上一版程式相容（`02-database.md` §5.1）比讓舊執行個體全部 503 合理。重新檢查讓補跑 `db:migrate` 之後不必重啟 |
| 平台自己的角色與權限（D5） | 權限目錄在程式碼、角色固定三種（`platform_admins.role`：`super-admin`／`operator`／`auditor`），不建角色表、不提供自訂角色 | 平台的權限只有十個以內、管理者只有少數幾位；自訂角色的表、畫面與反提權規則換不到實際的好處。需要時再加表，端點的宣告（`@RequirePlatformPermissions`）不必改 |
| 佈建的每一步都在背景工作裡（D12） | database 與 DB 角色的名稱是 `tenant_{code}_{8 位隨機}`；密碼在登記時產生、存在加密的連線字串裡；佈建工作不自動重試，失敗停在 `failed` 由平台管理者重試 | 代碼可以在刪除後重用，而刪除時 database 還沒清掉，名稱不能只用代碼；重試時沿用同一組連線字串，每一步都冪等（角色存在就把密碼改回來、database 存在就沿用） |
| 佈建完成 = 所有步驟都成功 | database、migration、seed、第一位管理員完成就改成 `active`；之後在租戶脈絡裡確認 bucket、寄啟用信，失敗只記在 `provision_error` | 啟用信的背景工作要在租戶脈絡裡執行，而只有 `active` 的租戶能進入；bucket 在第一次上傳前還會再確認一次 |
| 停用時撤銷所有 session（D13） | 先撤銷再停用；租戶的 DB 連不上時不擋停用 | 停用後租戶就不能進入，撤銷得在那之前；停用後網域一律 503，session 本來就用不了 |
| 背景工作監控頁搬到 apps/platform（D23） | apps/platform 加上 **全平台** 的監控（`/platform/jobs`，看得到每個租戶與平台工作）；backstage 的 `/job` 保留，只看自己租戶的 | 租戶的管理者仍需要看自己的匯出、寄信是否卡住；佇列查詢本來就以 `tenantId` 過濾，保留不會洩漏別的租戶。拿掉租戶的 `job:*` 要另寫 migration 清權限，好處不大 |
| 平台管理者由其他平台管理者建立（D5） | 建立成 `pending`、寄啟用信（`platform_auth_tokens`、平台工作 `platformAdmin.accountMail`）；忘記密碼沒有自助流程，由其他平台管理者「寄設定密碼的連結」 | 平台管理者人數少、權限大；自助的忘記密碼等於多一個對外的入口。連結不帶 `?tenant=`，apps/platform 的 `/setup`、`/reset-password` 據此走平台的端點 |
| 平台管理者開關外部 IdP（D22） | `tenants.allow_external_idp`，隨租戶脈絡帶著走：關掉時租戶不能新增或啟用連線，登入時當作沒有連線（包括「只允許 SSO」的網域回到密碼登入）；既有連線保留 | 關掉的理由通常是暫停而不是刪除；登入時不走連線才是真的關掉。只靠外部 IdP 登入、沒有密碼的帳號要用重設密碼 |
| 停用 = 網域回 503、撤銷所有 session（D13） | 停用與刪除都 **先改狀態再收尾**：撤銷 app session（`Tenancy.runForMaintenance`，不看狀態進入）、刪除帳號 id 是 `t:{tenantId}:*` 的 IdP session／grant／授權碼、斷掉 `t:{tenantId}` room 的即時連線、關掉連線池。排隊中的工作：租戶已刪除或停用時略過；migration 落後或 DB 連不上（`TENANT_UNAVAILABLE` 的 `details.reason = maintenance`）時交給 pg-boss 重試 | 只撤銷 refresh token 的話，重新啟用後使用者會靠還留著的 IdP session 直接登回來；先撤銷再停用則留下一個空窗，期間新發的 token 撤銷不到。暫時性的故障不該把寄信之類的工作丟掉 |
| 租戶的狀態改變立即生效（D2 的快取） | 只在本程序立即生效（`TenantDirectory.invalidate()`）；其他執行個體最多晚 `TENANT_CACHE_TTL` 秒 | 目前只部署一個 api 執行個體（WebSocket 也是單機的 adapter）。擴成多個執行個體時，改用平台 DB 的 `LISTEN/NOTIFY` 廣播失效，與 Socket.io 的 adapter 一起處理 |
| 每個租戶一份的初始資料在啟動時準備（`forEachActive`） | 另外發佈 `DomainEvent.TENANT_ACTIVATED`（佈建完成、重新啟用時，在那個租戶的脈絡裡），檔案模組據此建立系統資料夾 | 新佈建的租戶不必等程序重啟才有共用資料夾與私人根目錄 |
| `db:seed` 在每個租戶跑一樣的 seed | `SUPER_ADMIN_EMAIL` 的 super-admin 只建在 `SEED_TENANT`（預設 `default`）；其他租戶（含停用中的）只補權限目錄與系統角色 | 營運方共用的帳密不能出現在客戶的租戶；停用中的租戶也要補新增的權限，重新啟用時才不會缺 |
| refresh 輪替的規則寫在租戶的 `AuthService` | 抽成 `rotateRefreshToken`，租戶與平台各提供自己的 token 表 | 平台管理者的 session 用同一套規則（一次性使用、重用偵測、併發只有一個成功），安全相關的邏輯只有一份 |

### 10.7 被取代的做法：工作區（§10.7）

> 原 ADR-0018，2026-09-29 決定，同日被本章（§10）整份取代。

§10.7 在同一個資料庫裡做「工作區」（＝專案，只有一層）：**共用資料表 ＋ `workspace_id` 欄位、由應用層強制隔離**。
授權是兩層並用——工作區角色決定能做「哪些種類」的事，`resource_grants`（[`iam/06-resource-grants.md`](iam/06-resource-grants.md) §13 的資料夾 ACL）決定在工作區內能碰「哪幾個」資源。主要做法：

- 權限鍵與角色加上範圍（`scope`：`platform` ／ `workspace`），角色定義全域共用、指派分工作區；使用者在工作區 W 的權限 = 全域角色的 platform 鍵 ∪ 他在 W 的工作區角色的 workspace 鍵。
- 帳號是平台層級、跨工作區共用；成員資格與角色指派是 `workspace_members`、`workspace_member_roles`，以 email 邀請加入。
- D5：只有 super-admin 能看任何工作區的內容；持有 `workspace:*` 的平台管理員只能管理工作區本身（清單、名稱、成員與角色）。
- D8：請求以 **路由前綴** `/workspaces/:workspaceId/...` 帶工作區，工作區 **不放進 JWT**（同一個人可以在兩個分頁開不同的工作區）；前端網址是 `/w/:workspaceSlug/...`。
- 隔離靠三道應用層防線：組合外鍵 `(workspace_id, x_id)`、只有 guard 能產生的 `WorkspaceScope` 品牌型別、對每個工作區路由的越權整合測試；不用 Postgres RLS。權限快取 key 改成 `userId:workspaceId`、推播 room 改成 `ws:{id}:perm:{key}`。

評估過的隔離方式中，「每個租戶一個 schema／資料庫」當時以「migration 要跑 N 次、跨工作區的平台管理難寫」否決。
被取代的原因是產品要求改變（§10.1）：租戶要 **實體硬切分**（一個查詢忘了帶 `workspace_id` 就跨租戶，這種風險不能接受）、
backstage 不該看見租戶的切分（沒有成員、沒有 `/w/:slug`、沒有切換器）、平台管理者與租戶管理者是兩份資料。
§10.7 的 D2–D5、D8–D18 都建立在「同一個資料庫、同一份帳號」上，所以整份取代而不是修改；已完成的工作區實作（第一批與邀請）依 §10.2 D20 移除。

## 11. 設計決策：feature flag

> 原 ADR-0022，2026-09-30 決定。延伸 [`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9 的可啟用 feature；現行規格見 §5.2。

### 11.1 背景

[`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9 讓平台管理者為每個租戶開關 **長期存在的模組**（`tenants.features`）。編輯器之後會有另一種需求：
**暫時的上線開關**——新功能先合進 `main`、只對試用的租戶開、穩定後全面開放、最後連同開關與舊的程式碼路徑一起刪除；
上線後出問題時要能不部署就關掉。

兩者的差異：

| | 可啟用的 feature（[`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9） | Feature flag（本節） |
| --- | --- | --- |
| 壽命 | 永久 | 暫時，一定會被移除（`removeBy`） |
| 顆粒 | 整個 feature（plugin ＋ route ＋ controller） | 整個 feature，或 feature 內的一支端點、一個按鈕、一段分支 |
| 適用 | 只有 `TENANT_FEATURES` 列出的 feature | 任何地方，含常駐 feature（user、role、system…） |
| 新租戶的預設 | 全部啟用 | 程式預設值（通常是關） |
| 全平台一起切換 | 不需要 | 需要（全面開放、緊急關閉） |

現況可沿用的零件：`FeatureGuard`（JWT 之後、權限之前，未啟用回 `404 FEATURE_DISABLED`）、`TenantContext.features`、
`PATCH /platform/tenants/:id` 的平台層開關與稽核、`TENANT_FEATURES_CHANGED` → `resource.changed`（`tenantFeature`）→ 前端重抓 profile、
前端 `core/feature` 的 store、`FeatureActivator`、`requireFeature`、`useFeatureGate`。
另有一個沒人用的 `featureFlagPlugin`（`plugins/app/feature-flags.ts`，以 `attrs` 傳靜態值；[`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9.2 D3 已不允許這種做法）。

相關：§10.2 D22（平台層開關）、[`backend/05-rbac.md`](backend/05-rbac.md) §11（由伺服器判定）、[`backend/03-api-conventions.md`](backend/03-api-conventions.md) §12（id 經 OpenAPI 產進 SDK）；前端與規範見 [`frontend/02-plugin-system.md`](./frontend/02-plugin-system.md) §7.1、[`../coding-standards/01-general.md`](../coding-standards/01-general.md) §8。

### 11.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **flag 的目錄集中在 `core/feature-flags/feature-flags.ts`**：`FEATURE_FLAGS: FeatureFlagDefinition[]`（`key`、`description`、`defaultEnabled`、`owner`、`removeBy`）。key 用 `<模組>.<名稱>`（camelCase，例 `levelEditor.v2`）。**不** 讓各模組在 `onModuleInit` 註冊。目錄以 `FEATURE_FLAG_CATALOG` provider 注入（測試換成自己的目錄）；啟動時檢查格式、重複與日期 | 所有 flag 集中在一處：到期檢查、平台管理頁、驗證都讀同一份；目錄只是資料，`core/` 放它不違反「`core/` 不 import `modules/`」 |
| D2 | **兩級覆寫都在平台 DB**：租戶層是 `tenants.flags jsonb not null default '{}'`（`{ [key]: boolean }`，沒列出＝不覆寫）；全平台層是 `feature_flag_overrides`（`key` pk、`state`：`on` ｜ `off`、`updated_by`、`updated_at`，沒有列＝不覆寫） | 決定「誰先試」與「全面開放／緊急關閉」都是平台的事（[`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9.2 D8 同一個理由）；租戶層和 `features` 同一列，進入租戶時一起讀出，判斷不多查 DB |
| D3 | **生效值的優先順序**：全平台 `off` → 一律關（緊急開關，蓋過租戶層）；否則租戶層有值 → 用它；否則全平台 `on` → 開；否則 `defaultEnabled` | 緊急關閉必須壓過所有例外，才能保證「按下去就全部停」；全面開放時仍保留「某個租戶先不要」的例外 |
| D4 | **讀取**：`TenantContext` 加 `flags`（已過濾不認得的 key），與 `features` 由 `TenantDirectory` 一起載入與失效；全平台覆寫由 `FeatureFlagService` 在啟動時載入、快取 `TENANT_CACHE_TTL` 秒、變更時本機立即失效。`FeatureFlagService.isEnabled(key)` 是同步的，租戶脈絡內外（背景工作、平台端點）都能呼叫；沒有租戶脈絡時只看全平台層與預設值 | 判斷會出現在 guard 與業務分支裡，不能每次查 DB；多執行個體最多晚 `TENANT_CACHE_TTL` 秒，與租戶登記相同。2026-10-08 起全平台覆寫改成變更時經 `core/broadcast` 通知其他程序（[`01-system.md`](./01-system.md) §4.3） |
| D5 | **後端**：`@RequireFlag('<key>')` 可標在 class 或 handler，由既有的 `FeatureGuard` 一併判斷（同一個位置、同一個 `404 FEATURE_DISABLED`）；與 `@RequireFeature` 可以並存，兩者都要成立。業務分支內用 `FeatureFlagService.isEnabled()`。授權宣告照舊必填，`route-audit` 不變 | 「這個功能存不存在」只需要一個 guard、一種回應；關閉時回 404 不暴露功能存在（[`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9.2 D11） |
| D6 | **`/auth/profile` 加 `flags: string[]`**：只列出生效為開的 key。所有租戶都帶（flag 可以用在常駐 feature） | 前端只需要知道「開了哪些」；清單很短 |
| D7 | **變更與推播沿用 `features` 的路徑**：租戶層由 `PATCH /platform/tenants/:id` 的 `flags`（**完整的覆寫表**，取代而非增減；不認得的 key 回 `VALIDATION_FAILED`）寫入，稽核 `tenant.update` 的 `before`／`after` 帶 `flags`，之後 `TenantDirectory.invalidate()` 並發佈 `TENANT_FEATURES_CHANGED`。全平台層由 `PUT /platform/feature-flags/:key`（`{ state: 'default' \| 'on' \| 'off' }`）寫入，平台稽核 `featureFlag.update`，之後對 **每個 `active` 租戶** 發佈 `TENANT_FEATURES_CHANGED` | 前端已經會因為 `tenantFeature` 重抓 profile，不必新增事件、來源或前端邏輯 |
| D8 | **平台權限**：租戶層沿用 `tenant:update`；全平台層新增 `featureFlag:read`（super-admin、operator、auditor）與 `featureFlag:update`（super-admin、operator）。`GET /platform/feature-flags` 回目錄、全平台狀態、各有幾個租戶覆寫為開／關 | 緊急關閉要讓值班的 operator 也做得到；租戶層是租戶設定的一部分 |
| D9 | **前端**：`core/feature` 的 store 多存 `flags`，與 `features` 由同一個 profile 水合；`useFlag(key)` 在渲染時判斷（訂閱 store）。整個 feature 試行時登記進 `FEATURE_CATALOG`：安裝條件由「id 在 `features` 裡」改成每個項目宣告 `requires: { feature?: TenantFeature; flag?: string }`，**全部成立** 才安裝（現有項目只宣告 `feature`；之後會成為常駐的新 feature 只宣告 `flag`，flag 移除時改回 `main.tsx` 的 `.use()`）。`requireFeature`／`useFeatureGate`／卸載前導回首頁都以 catalog 的 id 判斷，不必改 | 整個 feature 的試行直接套用 [`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9 的 install／uninstall；局部 UI 不需要動註冊 |
| D10 | **移除 `featureFlagPlugin`**：刪除 `plugins/app/feature-flags.ts`、`main.tsx` 的 `.use()`、`AppPluginProperties.featureFlags` 的宣告 | 靜態 `attrs` 的做法已被 [`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9.2 D3 否定，留著會被誤用 |
| D11 | **到期檢查**：api 的單元測試逐一檢查 `FEATURE_FLAGS`，`removeBy` 早於今天就失敗，訊息列出 flag 與擁有者。要延期就改 `removeBy`（留下 commit 紀錄） | 沒有強制，暫時的開關會變成永久的；延期是一個看得見的決定 |
| D12 | **移除流程**：① 全平台設 `on`（或把 `defaultEnabled` 改成 `true` 並部署）觀察一段時間 → ② 刪掉 `@RequireFlag`／`isEnabled` 的判斷與舊路徑 → ③ 從 `FEATURE_FLAGS` 刪除；DB 殘留的租戶覆寫在讀取時被濾掉，`feature_flag_overrides` 的殘列由同一個 PR 的資料 migration 刪除 | 程式先不再依賴 flag，資料才清；讀取端的過濾讓順序錯了也不會壞 |

### 11.3 不做

- 租戶內依角色、依單一使用者開放：[`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9 已定「部分人可用」由權限表達。
- 百分比漸進釋出、A/B 實驗。
- apps/platform 自己的頁面用 flag（平台管理者的功能直接部署）；登入前的頁面讀 flag。

### 11.4 代價

| 代價 | 緩解 |
| --- | --- |
| 目錄集中在 `core/`，新增 flag 要改一個共用檔案 | 只加一列；衝突容易解。換到的是編譯期已知的 key |
| 全平台變更要對每個租戶推播 | 只在平台管理者按下時發生；事件本身只帶 `tenantId` |
| key 在 OpenAPI 上是字串，不是 enum（實作時改掉的做法：目錄常常是空的，空 enum 產生的 JSON Schema 是 `{ not: {} }`，SDK 拿不到可用的型別） | 伺服器依目錄驗證：租戶覆寫表裡不認得的 key 回 `VALIDATION_FAILED`、全平台切換回 `FEATURE_FLAG_NOT_FOUND`、`@RequireFlag` 的 key 不在目錄裡時路由稽核讓程序啟動失敗 |
| 到期檢查會讓與 flag 無關的 PR 失敗 | 這就是目的；延期只要改一行 |

### 11.5 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| 把 flag 當成一種系統設定（租戶 DB 的 `system_settings`） | 決定權在租戶管理者，不是平台；沒有全平台層；設定只支援純量且不帶 `removeBy` |
| 另開 `tenant_feature_flags` 表 | 多一次查詢與另一條失效路徑；「哪些租戶開了某個 flag」的查詢只在平台列表頁用，jsonb 也查得到 |
| 各模組 `defineFeatureFlag` 並在 `onModuleInit` 註冊 | key 到執行期才知道，DTO、OpenAPI、前端型別都拿不到 |
| 外部服務（LaunchDarkly、Unleash） | 多一個元件與一份資料；需求只有「租戶 × 開關」兩級 |

## 12. 設計決策：平台可關閉的 feature（回收桶、系統設定、外部 IdP、切換租戶）

> 原 ADR-0029，2026-10-01 決定。延伸 [`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9（修改其「原本待決、已定案的事項」2 的清單）；取代 §10.2 D22 的 `tenants.allow_external_idp`。現行規格見 §5.1。

### 12.1 背景

[`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9 讓平台管理者對每個租戶開關 `file`、`auditLog`、`job`，其餘 feature 一律常駐。
定位改成通用後台之後，有些通用能力並不是每個部署都要：

| 能力 | 不需要的情境 |
| --- | --- |
| 回收桶（列表與還原） | 租戶的資料保留政策是「刪了就是刪了」，不希望使用者自行救回 |
| 系統設定頁 | 平台代管、不讓租戶管理者自行調整執行期設定 |
| 外部 IdP | 租戶只用帳號密碼；原本已有獨立的 `allow_external_idp` 開關 |
| 切換租戶 | 只服務單一租戶的部署，選單裡的「切換租戶」只會造成困惑 |

外部 IdP 已經有一個平台層開關，但它是 **另一套**：獨立的欄位、獨立的 UI 區塊、獨立的錯誤碼
（`IDENTITY_PROVIDER_NOT_ALLOWED`），前端也沒有隨開關即時更新（變更時不推播）。

相關：[`backend/14-revisions.md`](backend/14-revisions.md) §9（回收桶與還原）、[`04-sso.md`](./04-sso.md) §12（外部 IdP）；前端見 [`frontend/02-plugin-system.md`](./frontend/02-plugin-system.md) §7。

### 12.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **`TENANT_FEATURES` 加四個 id**：`trash`、`systemSetting`、`identityProvider`、`tenantSwitch`。平台 DB 的預設值改為七個全開；migration（平台 0009）讓 **既有租戶** 全部啟用，`identityProvider` 沿用原本 `allow_external_idp` 的值 | 這四個原本都是常駐（或預設允許），升版不能讓任何租戶失去功能 |
| D2 | **外部 IdP 併進 `features`，刪除 `tenants.allow_external_idp`**：`TenantContext`／`PlatformTenant`／`UpdateTenantRequest` 不再有 `allowExternalIdp`；apps/platform 拿掉獨立的開關區塊，改由「啟用的功能」清單的一列表示；`IDENTITY_PROVIDER_NOT_ALLOWED` 與 `IdentityProviderList.allowed` 一併移除 | 同一種「平台決定租戶能不能用」的開關只留一套（[`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9 當時以「不做第二套」為由把它排除，現在反過來把舊的那套收進來）；改用 feature 之後，變更會推播 `tenantFeature`，backstage 的選單即時跟上 |
| D3 | **回收桶（`trash`）**：`GET /trash` 與各資源的 `POST /<resource>/:id/restore`（使用者、角色、群組、檔案、資料夾）標 `@RequireFeature('trash')`。`@RequireFeature` 改成 **handler 與 class 的宣告合併、全部都要啟用**（檔案的還原端點同時要 `file` 與 `trash`）。刪除照舊是軟刪除，`trash.purge` 照常在保留期滿後永久刪除。前端刪除成功的提示只在 `trash` 已安裝時附「復原」 | 「復原」本身就是回收桶的還原端點；只藏列表頁、留著還原端點等於沒關。資料與背景工作照舊，與 [`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9.2 D11 一致 |
| D4 | **系統設定（`systemSetting`）**：`GET`／`PATCH /system/settings` 標 `@RequireFeature`；`GET /system/settings/public`（登入前就要用）與 `GET /system/info` 不標。**已覆寫的值照樣生效**，關掉只是不能查看或修改 | 設定的消費端分散在各模組；關掉時改回預設值會在租戶不知情的情況下改變行為（例如放寬密碼規則）。與「資料保留、重新啟用後一致」的原則相同 |
| D5 | **外部 IdP（`identityProvider`）**：`/identity-providers` 整個 controller 標 `@RequireFeature`；登入流程（home realm discovery、`loginConfig`）判斷 `features` 是否含它，沒有就當作沒有連線——與原本 `allow_external_idp = false` 的行為相同。連線與外部身分的連結保留。apps/platform 關閉時的確認框另外說明對登入的影響（只靠外部 IdP、沒有密碼的人要先重設密碼） | 行為沿用 §10.2 D22，只是換一個來源；原本「關掉時仍可編輯、停用、刪除既有連線」的細節不保留——整頁消失，與其他 feature 一致 |
| D6 | **切換租戶（`tenantSwitch`）**：沒有後端端點，也沒有頁面；backstage 在 `FEATURE_CATALOG` 登記一個空的 plugin（`routes: []`），帳號選單以 `useIsFeatureReady('tenantSwitch')` 決定是否顯示「切換租戶」。apps/platform 的 `/enter` 不受影響 | 用同一個安裝狀態表示啟用與否，不必另開一條「profile 欄位 → UI」的路徑；`/enter` 是平台的入口，不屬於任何租戶 |
| D7 | **前端**：`trash`、`system`、`identity-provider` 三個 feature 改成可啟用（`AppDynamicPluginFactory`、最上層 route `beforeLoad: requireFeature(<ID>)`、從 `main.tsx` 移到 `FEATURE_CATALOG`）。其他 feature 往回收桶登記的類型（`registerTrashType`）不受影響：回收桶沒安裝時沒有人讀 | 照 [`frontend/02-plugin-system.md`](./frontend/02-plugin-system.md) §7 的步驟；側邊選單依頁面權限是否註冊自動隱藏 |

### 12.3 代價

| 代價 | 緩解 |
| --- | --- |
| 平台 migration 刪除欄位，舊版程式碼讀不到 `allow_external_idp` | 同一次部署；舊值在刪欄位前搬進 `features` |
| 關閉外部 IdP 後，租戶管理者看不到既有連線（原本還能編輯、刪除） | 連線保留，重新啟用後原樣出現；需要清理時由平台暫時打開 |
| `@RequireFeature` 的語意從「handler 蓋過 class」改成「合併」 | 現有用法沒有 handler 蓋過 class 的情況；單元測試與 `test/route-audit.spec.ts` 的對照表涵蓋 |

### 12.4 不做

- **租戶自行開關**：仍只有平台層（[`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9「原本待決、已定案的事項」1）。
- **全平台一次關閉**：目前以租戶為單位；單一租戶的部署關掉該租戶即可。要全平台預設不同時，改平台 DB 的預設值。

### 12.5 實作紀錄：關閉前列出受影響的數量

2026-10-07 補上（`hardening-followups.md` 的項目）：確認框除了文字說明，另外列出這個租戶現在受影響的數量。

- `GET /platform/tenants/:id/features/:feature/impact`（`tenant:read`）回 `{ feature, available, items: [{ key, count }] }`。
  平台端點以 `Tenancy.runForMaintenance` 進入那個租戶計算（不看租戶狀態：停用的租戶也能改 feature）；進不去租戶 DB 時 `available: false`。
- 計數由擁有 feature 的模組在 `onModuleInit` 向 `core/tenant` 的 `TenantFeatureImpacts` 登記（core 不認識業務模組）；
  `key` 的清單是 `TENANT_FEATURE_IMPACT_KEYS`，前端以對照表翻譯。沒有登記的 feature 回空清單。
- 目前只有 `identityProvider`：連線數、只允許 SSO 的網域數、連結了外部身分而自己沒有密碼的使用者數。
- apps/platform 按下關閉時先查（查詢期間停用開關），數量為 0 的項目不列；查不到時照樣開確認框，只有一般的說明。

### 12.6 實作紀錄：對外 API（`externalApi`）

2026-10-07 加入：對外 API 原本對每個租戶常駐，改為平台可關閉（細節見 [`06-external-api.md`](./06-external-api.md) §3.1）。

- 擋在 `FeatureGuard`：`@ExternalApi()` 的路由一律要求 `externalApi`（`requiredFeaturesOf()`），不在每個對外 controller 上標。
- 平台 migration 0019：預設值加入 `externalApi`，既有租戶全部啟用。
- 2026-10-08 改為 **服務帳號與對外 API 共用這個開關**：原本內部 api 的服務帳號與 token 管理不隨開關關閉（理由是停用期間仍要能撤銷外洩的 token），
  backstage 只在 token 列表上提示。改成連同管理一起關閉：停用期間 token 本來就呼叫不到，留著管理頁只會讓租戶以為功能可用；
  要清理時由平台暫時打開。id 沿用 `externalApi`（不必改平台 DB 的值），apps/platform 的名稱改為「服務帳號與對外 API」。

## 13. 設計決策：feature 參數（配額與上限）

> 原 ADR-0033，2026-10-02 決定。Webhook 的多個目標網址（D12～D16）見 [`backend/17-webhook.md`](./backend/17-webhook.md) §10；這裡是 feature 參數（D1～D11）。

### 13.1 背景

平台管理者目前只能對每個租戶「開或關」一個 feature。開了之後，租戶能用多少全由程式碼的常數決定：

| 能力 | 現況 |
| --- | --- |
| 稽核日誌 | 熱表保留 90 天，常數 `AUDIT_LOG_HOT_RETENTION_DAYS` |
| 檔案 | 單檔上限有（系統設定 `file.uploadMaxSize`），總容量沒有上限 |
| 背景工作 | 只有每個程序、每種工作的並行數；一個租戶入列大量工作就能佔滿所有 worker |
| 外部 IdP | 連線數沒有上限 |
| Webhook | 一個租戶最多 50 個訂閱（常數），一個訂閱只能有一個網址 |

2026-10-02 確認的產品需求：

- feature 除了開關，還要有 **數字與字串的參數**，由 **平台管理者** 在租戶詳情設定（租戶管理者不能改，這是「租戶買了多少」）。
- 第一批參數：稽核熱資料保存天數（預設 90）、檔案總容量（預設 2 GB）、背景工作 **同時執行** 的上限、外部 IdP 連線數上限、
  Webhook 可通知的網址數（**整個租戶**，預設 1）。
- 一個 Webhook 訂閱可以有 **多個目標網址**。

延伸 [`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9／§12（§12，平台層的 feature 開關）；相關 [`backend/17-webhook.md`](backend/17-webhook.md) §9（D7 訂閱的資料表、D13 自動停用、D17 手動送出）、[`backend/10-jobs.md`](backend/10-jobs.md) §9（背景工作）。

### 13.2 決定：feature 參數

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **參數定義在程式碼**：`core/tenant/tenant-feature-params.ts` 的 `TENANT_FEATURE_PARAMS`，每個參數有 `key`（`<feature>.<名稱>`）、所屬的 `feature`、`type`（`integer` ｜ `string`）、`defaultValue`、`unit`（`days` ｜ `megabytes` ｜ `count`，字串沒有）、整數的 `min`／`max`、字串的 `maxLength`／`pattern`。目錄在 `core/`：`TenantContext` 與背景工作佇列（都在 `core/`）要讀它，`core/` 不 import `modules/` | 與 `TENANT_FEATURES`、feature flag 目錄同一個做法：清單由程式維護，DB 只存值 |
| D2 | **平台 DB `tenants.feature_params jsonb NOT NULL DEFAULT '{}'`，只存覆寫值**（平台 migration 0012）。讀取時只留目錄裡的 key 且值通過驗證的項目（程式移除參數或收緊範圍後，殘留值回到預設，不讓請求失敗） | 與 `flags` 欄位相同；沒有覆寫的租戶跟著程式的預設，之後調整預設時才跟得上 |
| D3 | **API**：`PlatformTenant` 多一個 `featureParams`：目錄上每個參數一項（`key`、`feature`、`type`、`value`、`defaultValue`、`overridden`、`unit`、範圍），已是生效值。`PATCH /platform/tenants/:id` 接受 `featureParams: { [key]: value \| null }`——**只列要改的**，`null` 回到預設；值等於預設時也不存。不認得的 key、型別或範圍不對回 `VALIDATION_FAILED`（`fields["featureParams.<key>"]`） | 管理頁一次拿到要畫的東西（不必另一支目錄端點）；參數之間互不相關，部分更新比 flags 的「整張表取代」不容易誤蓋 |
| D4 | **稽核**：沿用 `tenant.update`，`before`／`after` 多帶 `featureParams`（覆寫表）。變更後 `TenantDirectory.invalidate()`；**不推播**（參數不影響前端安裝哪些 feature） | 與 features、flags 同一個交易與失效路徑 |
| D5 | **參數與開關無關**：feature 關閉時參數照常保留、照常生效（例：關掉稽核頁，封存仍依保留天數執行）。管理頁把參數列在所屬 feature 的那一列下 | 「關掉只是看不到頁面、資料與背景工作照舊」（§12） |
| D6 | **讀取**：`TenantContext.featureParams`（覆寫表）＋ `tenantFeatureParam(PARAM)`：取目前租戶的生效值；沒有租戶脈絡時拋錯（與 `requireTenant()` 相同）。`TenantRecord` 也帶覆寫表，給以 id 找租戶的地方（背景工作佇列）用 | 業務模組不必知道覆寫怎麼存；同步取值（租戶登記本來就快取在每個請求的脈絡裡） |

### 13.3 決定：第一批參數

| # | key | 預設 | 範圍 | 效果 |
| --- | --- | --- | --- | --- |
| D7 | `auditLog.hotRetentionDays` | 90 天 | 7–3650 | `auditLog.archive` 搬移早於「現在 − 天數」的紀錄（`pnpm db:archive-audit-logs` 同樣讀登記）。查詢是否要連冷表改看 **冷表最新一筆的時間**（索引的第一列），不再以保留天數推算：天數調大後，已在冷表的紀錄不會搬回熱表，以天數推算會漏查 |
| D8 | `file.storageQuotaMb` | 2048 MB | 1–10485760 | 租戶所有檔案的 `size` 合計（含上傳中的 `pending` 與回收桶裡的，不含縮圖與影像變體）。已用量是租戶 DB 單列的計數 `file_storage_usage.used_bytes`（migration 0036 以 `SUM(size)` 回填），不每次加總整張 `files`：登記、完成（大小有差時）、永久刪除在同一個交易內增減，軟刪除與還原不動它；`file.maintenance` 每天以 `SUM(size)` 對帳一次。`createUpload` 在登記 `pending` 的同一個交易以一條條件式 UPDATE（`used_bytes + size <= quota`）同時檢查與佔用，同時的登記以那一列的列鎖排隊，超過回 `409 FILE_STORAGE_QUOTA_EXCEEDED`（`details`：`quota`、`used`、`size`，位元組）。調小到低於已用量時不刪任何檔案，只擋新的上傳。`GET /files/upload-policy` 多回 `storageQuota`、`storageUsed`（讀計數，O(1)），檔案頁顯示用量；前端不隨每次檔案推播重抓用量，只在自己的上傳結束時重抓（[`frontend/05-data-layer.md`](./frontend/05-data-layer.md) §6.2）。細節見 [`backend/09-file.md`](./backend/09-file.md) §5.0 |
| D9 | `job.maxConcurrency` | 10 | 1–100 | 一個租戶 **所有種類** 的背景工作同時執行的筆數（跨程序）。worker 取到租戶的工作後，在該租戶 `active` 的工作中依 `(started_on, id)` 排名，排在上限之後的 **放回佇列**（改回 `created`、`start_after` 延後 5～10 秒、不計入重試次數、工作 id 不變），由之後的輪詢再取。排程觸發的展開（沒有租戶）與平台工作不受限。每個程序的 `concurrency` 照舊 |
| D10 | `identityProvider.maxProviders` | 10 | 1–100 | 建立連線時以 advisory lock 序列化後數，已達上限回 `409 IDENTITY_PROVIDER_LIMIT_REACHED`（`details.max`） |
| D11 | `webhook.maxUrls` | 1 | 1–500 | 整個租戶的訂閱 **不重複** 的目標網址數（[`backend/17-webhook.md`](./backend/17-webhook.md) §10.2 D13）。建立或修改訂閱時鎖表後計算；變更後的數量超過上限 **而且比變更前多** 才回 `409 WEBHOOK_URL_LIMIT_REACHED`（`details.max`）——升版前已經超過的租戶仍能修改、刪除、減少網址 |

- 背景工作的放回（D9）直接改 pg-boss 的工作表：pg-boss 的 API 只能更新還沒開始的工作，而 `fail` 會耗掉重試次數並觸發退避。
  pg-boss 完成工作時只更新 `active` 的列，handler 回傳後 pg-boss 的完成是空操作。表結構相依集中在 `core/jobs/job-store.ts`。
  `exclusive`（`stately`）佇列已有一筆排隊時放不回去（唯一索引），那一筆以 `{ skipped }` 結束——排隊中的那一筆會做同一件事。
- 配額與上限的檢查都在業務交易內，以 advisory lock 或表鎖序列化：同時送出不會一起超過上限。

### 13.4 不做

- 租戶管理者自行調整參數（D3 只在平台端點）；全平台一次改預設值（改程式的 `defaultValue`）。
- 參數的歷史版本、排程生效。
- 背景工作依種類分開的上限、優先序（D9 只有一個總上限）。
- 檔案配額計入縮圖與影像變體、配額快取（每次上傳前加總，`files` 有 `size` 欄位，一個租戶的列數加總的成本可接受）。
- 每個網址各自的事件或密鑰（見 [`backend/17-webhook.md`](./backend/17-webhook.md) §10）。

### 13.5 代價

| 代價 | 緩解 |
| --- | --- |
| 背景工作的放回依賴 pg-boss 的表結構與「完成只更新 active」的行為 | 集中在 `job-store.ts`；整合測試以真的 pg-boss 驗證放回與之後的執行 |
| 被放回的工作最多晚 10 秒才再被取到；租戶持續塞滿時後面的工作一直延後 | 上限是給「不讓一個租戶佔滿 worker」，不是排程保證；放回不耗重試次數 |
| 每次上傳前加總 `files.size` | 一個租戶的檔案列數有限；之後真的太慢再改成維護一個計數 |
| 預設只能通知 1 個網址，升版前已有多個訂閱的租戶超過上限 | D11：只擋「變多」的變更；平台管理者可以調高 |

### 13.6 實作紀錄

| 項目 | 補充 |
| --- | --- |
| D3 | `UpdateTenantRequest.featureParams` 在 OpenAPI 上是 `Record<string, number \| string \| null>`（zod 的 `partialRecord`）；key 仍以 `TenantFeatureParamKey` 驗證 |
| D7 | `archiveAuditLogs()` 改成由呼叫端傳入保留天數；排程讀 `TenantContext`，`pnpm db:archive-audit-logs` 讀 `ScriptTenant.featureParams` |
| D8 | 不帶資料夾的上傳原本不在交易內；`FileFolderService.insideFolder()` 改成一律開交易，advisory lock 才有作用 |
| D9 | 排名與放回在 `JobStore.activeAhead()`／`requeue()`（`JOB_SCHEMA` 從 `job-queue.ts` 搬到 `job-store.ts`，避免循環 import）；放回時一併清掉 `started_on`、`heartbeat_on`。每一筆租戶工作開始前都要排名，所以兩段都走索引：租戶的工作送出時帶 pg-boss 的 `group: { id: tenantId }`，這一筆以主鍵 `(name, id)` 找、計數以 `name IN (已註冊) AND group_id = 租戶 AND state = 'active'` 用 pg-boss 內建的 `job_i7`。原本以 `data->>'tenantId'` 比對，每一筆都全表掃描所有租戶 7 天內的工作（[`backend/10-jobs.md`](./backend/10-jobs.md) §3） |
| 前端 | apps/platform 的參數列在「啟用的功能」每個 feature 那一列下，編輯是單一參數的對話框（只送那一個 key）；backstage 的檔案管理器側欄顯示容量用量（`FileStorageUsage`） |

## 14. 設計決策：租戶用量

> 2026-10-08 決定並實作（原提案 `tenant-usage`，已刪除）。

### 14.1 背景

平台管理者看不到「每個租戶用了多少」：

- Prometheus 指標刻意 **不帶租戶標籤**（基數會爆，[`08-monitoring.md`](./08-monitoring.md) §2.3），依租戶只能從 trace 的 `b2b.tenant` 個別追。
- 配額（`file.storageQuotaMb`，§5.3）在上傳當下判斷，但沒有地方看「離上限還有多少」。
- 決定方案、找出沉睡或濫用的租戶，都需要每個租戶的用量。

### 14.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **寬表** `tenant_usage_daily`（平台 DB，平台 migration 0023）：主鍵 `(tenant_id, date)`，一個量一欄；快照欄可為 `null`（那天還沒彙總），計數欄預設 0；另有 `(date)` 索引給保留期限的清理 | 清單要依量排序、詳情要一次取 30 天：寬表一列就是一天，排序直接用欄位。新增一個量要加欄位與 migration，量不常變 |
| D2 | **快照每小時**：平台工作 `tenant.usageRollup`（`scope: 'platform'`、`exclusive`），cron `TENANT_USAGE_ROLLUP_CRON` 預設 `5 * * * *`，覆寫 **當天** 的快照欄 | 每天一次的話，清單上的數字最多晚一天；一個租戶幾個 `count(*)`，每小時跑的成本很低。歷史日的值自然是那天最後一次快照 |
| D3 | **請求與背景工作是計數**：每個程序在記憶體依「日期 × 租戶」累計，每分鐘一條 `INSERT … ON CONFLICT DO UPDATE SET x = x + excluded.x`，程序結束前寫一次；寫入失敗那一輪丟掉、記指標 | 每個請求都寫 DB 會讓唯讀的請求也變成寫入。當掉最多少記一分鐘：數字用來看趨勢、不計費（提案開放問題 1）。失敗不重送：平台 DB 長時間連不上時記憶體不會一直長 |
| D4 | **日期一律 UTC 的日曆日** | 多個程序、平台管理者不一定同時區；與排程的 cron（UTC）一致。畫面上註明 |
| D5 | **快照的來源由擁有者模組登記**（`core/usage` 的 `TenantUsageSnapshots`）：`modules/user` 登記使用者數、服務帳號數、最後登入；`modules/file` 登記儲存量與配額 | `core/` 與彙總工作不認識業務資料表（[`coding-standards/07-layer-dependencies.md`](../coding-standards/07-layer-dependencies.md) §3.2），與 `TenantFeatureImpacts` 同一個做法 |
| D6 | **保留 400 天**（`TENANT_USAGE_RETENTION_DAYS`，最少 31），彙總工作順便刪除 | 夠做年同期比較；一天只有「租戶數」那麼多列。真的要計費時另做月彙總（提案開放問題 2） |
| D7 | **最後活動** = 人類使用者最後一次登入，與最後一個有對外 API 請求的日子（當天 00:00 UTC），取較晚者 | 登入時間已經有欄位，不必另外寫入；只用 API token 的租戶沒有人登入，以對外 API 的請求補上（提案開放問題 4） |
| D8 | **配額警示門檻 80%（程式常數）**；彙總時 **越過** 才通知（上一次快照低於門檻或沒有快照，這次高於），收件人是角色有 `tenant:update` 的平台管理者（能調整配額的人），類型 `tenant.storageNearQuota` | 每天重發會變成噪音；越過時一次就夠，降回去再越過會再發。門檻是產品的決定，要依租戶調整時再改成 feature 參數 |
| D9 | **租戶管理者這一版看不到**（backstage 沒有用量頁） | 配額本來只有平台看得到；資料已在平台 DB，之後只要加一個唯讀端點與頁面（提案開放問題 3） |
| D10 | **請求在租戶的 middleware 之後計數**（`UsageRequestMiddleware`），含被 guard 擋下的（401、403、429）；`/health` 不算；沒有租戶的請求（apps/platform 網域）不算 | interceptor 看不到被 guard 擋下的請求，而那些請求一樣佔用服務；`httpMetricsMiddleware` 在租戶決定之前執行，拿不到租戶 |
| D11 | **背景工作數 = 開始執行的租戶工作**（`JobQueue` 進入租戶後計一次，重試也算），不是入列數 | pg-boss 的工作只保留幾天（高流量的工作 1 天），事後從佇列表數不準；在執行時計數與請求同一條路徑 |
| D12 | **清單的排序在 SQL**：以三個 `LEFT JOIN LATERAL`（最近一次快照、近 7 天的請求合計、最後一個有對外 API 請求的日子）取摘要；降冪時沒有值的排最後、升冪時排最前；以代碼收尾 | 伺服器分頁要在資料庫排序；一個租戶最多 400 列，都走主鍵。升冪時「從沒活動過」的租戶排第一，找沉睡租戶時最先看到 |

### 14.3 不做

- 即時（秒級）用量、計費與發票。
- 租戶管理者自己看的用量頁（D9）。
- 依量的告警規則（只做儲存配額的警示）；其他量要警示時再加。
- 對外 API 依 token 的用量（`api_tokens.last_used_at` 已有最後使用時間）。

### 14.4 代價

| 代價 | 緩解 |
| --- | --- |
| 程序崩潰時少記最多一分鐘的請求與背景工作 | 正常關機會寫出最後一輪；數字只看趨勢 |
| 每個請求多一次記憶體累加，每個程序每分鐘一次平台 DB 寫入 | 一條 INSERT 寫完所有租戶 |
| 每小時對每個租戶多幾個 `count(*)` | 依序進入租戶，不一次打開所有連線；`users` 以租戶的規模可接受 |
| 新增一個量要加欄位與 migration（D1） | 量不常變；換來排序與查詢簡單 |

### 14.5 替代方案

| 方案 | 不選的原因 |
| --- | --- |
| 直式表（`tenant_id, date, metric, value`）（提案的初稿） | 清單依量排序要先轉置；不同型別的量（時間、位元組）擠在同一個 `value` 欄 |
| 每天彙總一次（提案的初稿） | 清單上的數字最多晚一天；每小時的成本很低 |
| 依租戶標籤的 Prometheus 指標 | 時間序列隨租戶數爆量（[`08-monitoring.md`](./08-monitoring.md) §2.3） |
| 從 pg-boss 的工作表數背景工作 | 保留期限短，彙總時已經被清掉 |
| 通知類型 `tenant.quotaNearLimit`，參數帶哪一種配額（提案的初稿） | 目前只有儲存一種配額；通用的句子要再翻譯配額名稱。有第二種配額時再加類型 |


## 15. 設計決策：平台未開放的 feature 一律隱藏

> 2026-10-10 決定。延伸 §12（平台可關閉的 feature）與 [`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9。

### 15.1 背景

§12 與 [`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9 讓關閉的 feature 的頁面、選單與登記一起消失，
但盤點後仍有地方露出平台沒有開放的功能：清單由後端提供而沒有依 feature 過濾（權限目錄、系統設定、通知、審批類型），
前端寫死的清單（篩選選項），以及灰掉並註明「未啟用」「平台未開放」的選項（審批流程的審核者種類、MFA 政策的驗證方式）。

產品規則（2026-10-10 確認）：**平台沒有開放的功能，租戶的畫面上一律看不到**——不灰掉、不註明「未啟用」、不留會在操作時才報錯的入口。

### 15.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **權限鍵屬於 feature**：`core/authz/permission-features.ts` 的 `permissionFeaturesOf(key)`——資源對應一個 feature（`file`、`job`、`auditLog`、`identityProvider`、`group`、`serviceAccount` → `externalApi`、`webhook`、`announcement`、`orgUnit` → `organization`、`approvalFlow` → `approvalChain`、`gallery`），`approval:override` 屬於 `approvalChain`，每個 `*:export` 另外屬於 `dataTransfer`；全部啟用才算存在。`GET /permissions`（含依賴樹裡指向它們的 `includes`／`requires`）、`GET /roles/:id/permissions`、`/auth/profile` 與 `GET /users/:id/permissions` 的 `permissions`、`GET /users/:id/permission-sources` 都不列不存在的鍵。**授權判斷不變**：關閉的 feature 的端點本來就由 `FeatureGuard` 回 404 | 權限是使用者看到最多 feature 痕跡的地方（角色編輯器、權限目錄、API token 的範圍、權限來源）；從 profile 拿掉之後，前端寫死的頁面權限（系統設定入口的 `approvalFlow:read`、回收桶入口的 `file:delete` 等）也自動跟上。角色的權限是增減語意（`PATCH /roles/:id/permissions`），看不到的鍵不會因為儲存而被移除，重新開放後原樣恢復 |
| D2 | **系統設定屬於 feature**：`SettingDefinition.feature`；`GET /system/settings` 不列、`PATCH` 回 `SETTING_NOT_FOUND`。目前：`file.uploadMaxSize`（`file`）、`trash.retentionDays`（`trash`）、`gallery.stripOriginalLocation`（`gallery`）、`dataTransfer.retentionDays`（`dataTransfer`）、`announcement.*`（`announcement`）、`auth.personalTokenMaxDays`／`auth.serviceAccountTokenMaxDays`（`externalApi`）。前端的分類沒有設定時本來就不顯示 | 已覆寫的值照樣生效（§12.2 D4），只是不能看也不能改 |
| D3 | **審批類型屬於 feature**：`ApprovalHandler.feature`（資料夾存取申請屬於 `file`）。所屬 feature 沒有開放時，這類請求不出現在列表、待審數、匯出與流程設定，詳情與審核回 `APPROVAL_NOT_FOUND`。前端的類型篩選同樣不列 | 原本關掉 `file` 之後，審核者仍能核准資料夾存取申請，而且核准會真的寫入資料夾授權。請求保留，重新開放後原樣出現 |
| D4 | **角色的持有者只算人**：`userCount` 不含服務帳號；持有者列表只在 `externalApi` 開放時列出服務帳號（`RoleHolder.kind`），前端連到服務帳號頁 | 服務帳號以同樣的邊持有角色；原本關掉 `externalApi` 後仍出現在角色詳情，而且連到使用者詳情（找不到） |
| D5 | **Webhook 的網址額度先告訴表單**：`GET /webhooks/url-limit?subscriptionId=` 回 `{ max, available }`（`webhook.maxUrls` 扣掉其他訂閱已用的，與送出時的檢查同一條規則）；表單的「新增網址」只在還有額度時出現 | 原本前端只看每個訂閱 10 個的常數，預設額度 1 的租戶加了第二個網址才在送出時收到 409 |
| D6 | **通知類型屬於 feature**（`defineNotification` 的 `feature`，原本只用於事件管理）：通知中心、未讀數與通知總覽不列；前端通知總覽的類型篩選同樣不列 | 原本關掉之後舊的通知還在，只是點不進去 |
| D7 | **前端寫死的清單依 `useIsFeatureReady` 過濾**：稽核紀錄的資源篩選、審批的類型篩選、通知總覽的類型篩選；審批流程的審核者種類（群組、主管、部門）不能用時不列（已儲存的規則保留它自己的選項，提示不提「未啟用」）；MFA 政策頁不列平台沒有開放的驗證方式（[`backend/21-mfa.md`](backend/21-mfa.md) §6）；資料夾授權不列群組的授權（`group` 關閉時本來就暫停）；`approvalChain` 關閉時審批詳情不顯示關卡的進度與「卡住了」 | 同一條規則；後端已經不提供或不生效的東西，畫面上也不出現 |
| D8 | **回收桶沒有開放時，刪除的確認與提示不提回收桶與還原** | §12.2 D3 只拿掉「復原」按鈕，文案仍說「可以從回收桶還原」 |
| D9 | **匯入頁登記在 `dataTransfer` 的 catalog**：`FEATURE_CATALOG` 的 routes 列出所有 `requireFeature('dataTransfer')` 的匯入頁（使用者、角色、標籤、群組、組織） | 使用中被關閉時才會導回首頁（[`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9.2 D9）；原本只列了使用者的匯入頁 |

### 15.3 不做

- **使用者自己已註冊的 MFA 方式**：平台關掉某個方式後，帳號安全頁仍列出已註冊的因子並標「目前無法使用」——那是使用者自己的資料，留著才能移除。
- **Webhook 已訂閱的事件**：所屬 feature 關閉時照樣列在訂閱上（存的是名稱，重新開放後就會送，[`backend/17-webhook.md`](backend/17-webhook.md)）。
- **稽核紀錄與審批的歷史內容**：稽核的每一筆紀錄照樣顯示（只是篩選選項不列）。

### 15.4 代價

| 代價 | 緩解 |
| --- | --- |
| 新增權限鍵、設定、審批類型、通知類型時要決定它屬於哪個 feature | 權限鍵依資源自動對應，只有例外要寫；其餘在定義上多一個選填欄位，與 `defineWebhookEvent`、`TrashHandler` 的 `feature` 同一個做法 |
| 通知列表多一個 `type NOT IN (…)` 條件 | 只在有 feature 關閉時才加；索引的前綴（收件人、時間）不變 |

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

對外 API（另一個程序，[`06-external-api.md`](./06-external-api.md)）不看網域：`TokenTenantMiddleware` 以 API token 的租戶代碼
找租戶（`findByCode`），全平台只有一個對外網域。

平台管理者的端點（`/platform/*`）**只在 apps/auth 的網域有效**：租戶網域、未登記的網域、直接以 IP 連線一律在 `TenantMiddleware`
回 `404 PLATFORM_ONLY`，只套在 apps/auth 網域上的網路控制（WAF、IP 白名單）才保護得到平台管理。

- Host 取自 `requestHost()`：只有受信任的代理（`TRUST_PROXY`）帶來的 `X-Forwarded-Host` 才採用，不能靠標頭換租戶。
  所以受信任的代理 **必須覆寫** 這個標頭：兩份 nginx 設定都 `proxy_set_header X-Forwarded-Host $http_host`
  （[`01-system.md`](./01-system.md) §4.2）；前面另有 LB 時同樣要求。
- `TenantDirectory` 快取查詢結果 `TENANT_CACHE_TTL` 秒（「找不到」最多 5 秒）；租戶管理改了登記時 `invalidate()` 立即生效，
  並經平台 DB 廣播（頻道 `tenant_directory`）讓其他程序也整份重新讀（[`01-system.md`](./01-system.md) §4.4）。
  另有「網域 → 租戶 id」的同步快照（每 `TENANT_CACHE_TTL` 秒重載），給 oidc-provider 的同步判斷（redirect URI 是否屬於租戶）用。
- **Host 由客戶端決定、而且在速率限制之前解析**：不在快照裡的 Host 直接視為找不到，不查平台 DB；格式不像網域或租戶代碼的值
  （`X-Tenant`、`/tenants/lookup?code=`）也不查。三個快取（網域、id、代碼）都是有上限的 LRU（`bounded-cache.ts`，各 5000 筆）。
  代價：漏掉廣播時，另一個程序剛新增的網域，這裡最多晚 `TENANT_CACHE_TTL` 秒才認得。
- 租戶不能進入時回 `503 TENANT_UNAVAILABLE`，`details.reason` 分兩種：`inactive`（停用、佈建中、佈建失敗）與
  `maintenance`（migration 落後、DB 連不上）。背景工作依此決定略過或重試（§6）。

## 3. 連線與脈絡

| 元件 | 做什麼 |
| --- | --- |
| `TenantContext`（AsyncLocalStorage） | `{ id, code, db, storageBucket, features, flags }`；`currentTenant()`、`requireTenant()` 讀取 |
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
| 清單 | `GET /platform/tenants`（`tenant:read`） | 未刪除的租戶，依建立時間舊到新；伺服器分頁（`offset`、`limit` 預設 50、最多 100）、`q` 比對代碼／名稱／任一網域（部分相符、不分大小寫）、`status` 篩選；回應另帶 `baseDomain`（建立時的預設網域上層） |
| 建立 | `POST /platform/tenants`（`tenant:create`） | 登記租戶（`provisioning`）：代碼、名稱、第一位管理員的 email；預設網域 `{code}.<TENANT_BASE_DOMAIN>`（D24）；產生 database 與 DB 角色的名稱（`tenant_{code}_{8 位隨機}`）與密碼、bucket（`b2b-{code}`，用過就加序號）；排入佈建工作 |
| 佈建 | 背景工作 `tenant.provision`（平台工作，不自動重試） | ① 建立 DB 角色與 database（`TENANT_PROVISIONING_DATABASE_URL`，要有 `CREATEDB` 與 `CREATEROLE`）② 跑租戶 migration ③ 權限目錄、系統角色、第一位 super-admin（`pending`）④ 改成 `active` ⑤ 在租戶脈絡裡寄啟用信、確認 bucket、發佈 `TENANT_ACTIVATED`（檔案的系統資料夾）。①–④ 失敗停在 `failed`（原因記在 `provision_error`）；⑤ 的失敗不改狀態，只記原因 |
| 重試佈建 | `POST /platform/tenants/:id/provision`（`tenant:create`） | 只接受 `failed`；每一步都冪等（角色存在就把密碼改回來、database 存在就沿用） |
| 佈建中斷 | 背景工作 `tenant.provisionSweep`（每 5 分鐘）；重試與刪除前也先跑一次 | 程序在佈建途中被重啟時，工作在逾時（15 分鐘）後被收回，租戶卻停在 `provisioning`：超過逾時 5 分鐘的改成 `failed`（`provision_error` 寫「佈建中斷」），之後就能重試或刪除 |
| 改名、網域、平台層開關 | `PATCH /platform/tenants/:id`、`POST|DELETE …/domains`（`tenant:update`） | 網域一個只屬於一個租戶、不能移除最後一個與主要網域（第一個，`TENANT_PRIMARY_DOMAIN`）、apps/auth 的網域不能登記；`features`、`flags` 見 §5.1 |
| 停用 | `POST /platform/tenants/:id/disable`（`tenant:update`） | **先改狀態再收尾**：撤銷 app session、刪除這個租戶帳號（`t:{tenantId}:*`）在 IdP 的 session／grant、斷掉 `t:{tenantId}` room 的即時連線、關掉連線池。網域之後一律 503 |
| 啟用 | `POST /platform/tenants/:id/enable` | 回到 `active`，發佈 `TENANT_ACTIVATED` |
| 刪除 | `DELETE /platform/tenants/:id`（`tenant:delete`） | 停用並收尾、標記刪除、釋出網域；代碼之後可以給新租戶。database 與 bucket 留著 |
| 清除 | `pnpm db:drop-tenant <代碼或 id> [--confirm]` | 只處理已刪除、database 名稱是佈建產生的租戶：清空並刪除 bucket、`DROP DATABASE … WITH (FORCE)`、`DROP ROLE`、刪除 IdP 殘留與佇列裡的工作、移除登記。不加 `--confirm` 只列出 |

每個動作都寫平台稽核（`platform_audit_logs`，D19），**與狀態或網域的變更在同一個平台 DB 交易**：稽核寫不進去，變更也不生效。
停用、刪除的收尾（撤銷 session、IdP、連線池）在交易之後，失敗的步驟另外記一筆 `tenant.disable.cleanup`（或寫進 `tenant.delete` 的
`cleanupFailed`）。網域的增刪先鎖住租戶列（`FOR UPDATE`）再數網域，同時移除兩個網域不會把網域移光。
管理頁在 apps/auth 的 `/tenant`、`/tenant/$id`。

### 5.1 平台層開關

平台管理者在租戶詳情頁開關、存在平台 DB 的 `tenants`，經 `TenantDirectory` 進到每個請求的 `TenantContext`。
租戶自己的管理者看得到結果，但不能改。

| 欄位 | 值 | 效果 | 出處 |
| --- | --- | --- | --- |
| `features` | `text[]`，預設全部（`{file,auditLog,job,trash,systemSetting,identityProvider,tenantSwitch,webhook}`） | 可啟用 feature 的 id（`core/tenant/tenant-features.ts` 的 `TENANT_FEATURES`）。沒列出的 feature：api 以 `@RequireFeature()` 標的端點回 `404 FEATURE_DISABLED`（`common/guards/feature.guard.ts`；handler 與 class 的宣告合併，全部都要啟用）；`/auth/profile` 的 `features` 不含它，前端不安裝它。該 feature 的背景工作照常執行，資料保留 | [ADR-0021](../adr/0021-runtime-feature-activation.md) D8、D11、[ADR-0029](../adr/0029-toggleable-platform-features.md)、[ADR-0030](../adr/0030-webhooks.md) D8 |
| `flags` | `jsonb`，預設 `{}` | feature flag 的租戶層覆寫 `{ [key]: boolean }`，沒列出 = 跟著全平台與預設值；見 §5.2 | [ADR-0022](../adr/0022-feature-flags.md) D2 |

各 feature 停用時的效果：

| id | 停用時 | 照舊 |
| --- | --- | --- |
| `file` | `/files`、`/file-folders` 回 404；backstage 沒有檔案頁 | 檔案與物件、背景工作 |
| `auditLog` | `/audit-logs` 回 404；沒有稽核頁 | 稽核照常寫入、封存 |
| `job` | `/jobs` 回 404；沒有背景工作頁 | 工作照常執行 |
| `trash` | `GET /trash` 與各資源的 `POST …/:id/restore` 回 404；沒有回收桶頁，刪除的提示沒有「復原」 | 刪除仍是軟刪除，`trash.purge` 在保留期滿後永久刪除 |
| `systemSetting` | `GET`／`PATCH /system/settings` 回 404；沒有系統設定頁 | 已覆寫的值照樣生效；`/system/settings/public` 不受影響 |
| `identityProvider` | `/identity-providers` 回 404；登入時當作沒有連線（email 網域不導向外部 IdP，只允許 SSO 的網域回到密碼登入） | 連線與外部身分的連結保留 |
| `tenantSwitch` | backstage 帳號選單沒有「切換租戶」 | apps/auth 的 `/enter` |
| `webhook` | `/webhooks` 回 404；沒有 Webhook 頁；`emit()` 不寫事件也不入列，已入列的投遞略過（期間的事件之後不補送） | 訂閱與投遞紀錄保留；`webhook.cleanup` 照常清理 |

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
  → apps/auth 的 `TENANT_FEATURE_LABEL_KEY`／`TENANT_FEATURE_DESCRIPTION_KEY` 與語系。

### 5.2 Feature flag（試行開關）

決定與理由見 [ADR-0022](../adr/0022-feature-flags.md)。§5.1 的 `features` 是 **長期的模組**（租戶買了什麼）；
feature flag 是 **暫時的上線開關**：新功能先合進 `main`、先開給試用的租戶、穩定後全面開放，最後連同開關與舊的程式碼路徑一起刪除。

**目錄**（`apps/api/src/core/feature-flags/feature-flags.ts` 的 `FEATURE_FLAGS`）：每個 flag 有 `key`（`<模組>.<名稱>`，camelCase）、
`description`、`defaultEnabled`、`owner`、`removeBy`（`YYYY-MM-DD`）。啟動時檢查格式、重複與日期；`removeBy` 過了還在目錄裡，
單元測試（`core/feature-flags/__tests__/feature-flags.spec.ts`）就失敗。目錄以 `FEATURE_FLAG_CATALOG` provider 注入，整合測試換成自己的目錄。
key 在 OpenAPI 上是字串（目錄常常是空的），由伺服器依目錄驗證。

**兩級覆寫**（都在平台 DB）：

| 層級 | 儲存 | 誰改 | 端點（apps/auth） |
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
全平台層快取在 `FeatureFlagService`，每 `TENANT_CACHE_TTL` 秒與切換時重新讀取；多個執行個體時其他程序最多晚 `TENANT_CACHE_TTL` 秒。
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

## 6. 周邊元件怎麼分租戶

| 元件 | 做法 | 詳見 |
| --- | --- | --- |
| 背景工作 | 佇列在平台 DB；信封 `{ tenantId, payload }`，handler 在那個租戶裡執行。交易內入列寫租戶 DB 的 `job_outbox`，提交後搬進佇列。排程觸發的租戶工作展開成每個 `active` 租戶一筆。租戶已刪除或停用時略過；`maintenance` 交給重試 | [`backend/10-jobs.md`](./backend/10-jobs.md) |
| 權限／使用者快取 | key 是 `{tenantId}:{userId}`；關係圖寫入後整個租戶的權限快取失效，以 `{ tenant, revision }` 在平台 DB 廣播給其他程序（租戶 DB 各自的 `NOTIFY` 送不到別的 database）；使用者快取的失效以 `{ tenant, users }` 廣播 | [`backend/05-rbac.md`](./backend/05-rbac.md) §5、[`01-system.md`](./01-system.md) §4.4 |
| 即時推播 | room 帶租戶：`t:{tenantId}:perm:{key}`、`t:{tenantId}:user:{id}`、`t:{tenantId}`；Origin 同源（租戶自己的網域）一律允許 | [`backend/08-realtime.md`](./backend/08-realtime.md) §6、§11 |
| 物件儲存 | 每個租戶一個 bucket（`tenants.storage_bucket`）；presigned URL 以 `FILE_STORAGE_PUBLIC_ENDPOINT` 的 `{tenantOrigin}` 簽成租戶自己網域的 `/storage` | [`backend/09-file.md`](./backend/09-file.md) §3、§3.1 |
| 寄信 | 產品頁面的連結用租戶的主要網域（找不到就拋錯重試）；帳號流程的連結在 apps/auth、帶 `?tenant=` | [`backend/11-mail.md`](./backend/11-mail.md) |
| 稽核 | 租戶內的動作寫租戶的 `audit_logs`；平台管理者的動作寫 `platform_audit_logs`，兩邊互相看不到 | [`backend/06-audit-log.md`](./backend/06-audit-log.md) |
| 外部 IdP | 連線在租戶 DB，由租戶的管理者在 backstage 設定；平台只有開關（§5.1） | [`04-sso.md`](./04-sso.md) |
| 可啟用的 feature、feature flag | 平台 DB 的 `tenants.features`、`tenants.flags` 與 `feature_flag_overrides`；api 以全域的 `FeatureGuard` 擋下未啟用的端點 | §5.1、§5.2 |
| 領域事件 | 在發佈者的租戶脈絡裡傳給訂閱者；`TENANT_ACTIVATED` 讓每個租戶一份的初始資料在佈建、重新啟用時補上 | `core/events` |
| Access token | 帶 `tid`（租戶）或 `realm: 'platform'`；拿到別的網域一律無效 | [`backend/04-auth.md`](./backend/04-auth.md) |

## 7. 部署

- **DNS 與 TLS**：租戶的預設網域是 `{code}.<TENANT_BASE_DOMAIN>`，所以 `*.<TENANT_BASE_DOMAIN>` 要有 wildcard DNS 與
  wildcard 憑證（TLS 由前面的 LB／ingress 終結）。客戶自己的網域要另外設 DNS 與憑證，再由平台管理者加到租戶上。
- **反向代理**：backstage 的 nginx 是 `server_name _`，任何網域都由它服務，並把 `Host`（含 port）原樣轉給 api 與
  file-storage（`deploy/nginx.conf`）。apps/auth 是另一個 origin（`deploy/nginx.auth.conf`）。
- **同源**：每個租戶的頁面、`/api`、`/storage`、WebSocket 都在自己的網域，CSP 維持 `connect-src 'self'`。
- **單一 api 執行個體**：租戶狀態的變更（停用、網域）經廣播在每個程序立即生效（漏掉時最多晚 `TENANT_CACHE_TTL` 秒）；
  其他程序寫入的推播經事件轉送送到每個程序（[`backend/08-realtime.md`](./backend/08-realtime.md) §7.6）。擴成多個執行個體的前提見 [`01-system.md`](./01-system.md) §4.3。

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
| `pnpm db:migrate` | 平台 DB ＋ 每個未刪除的租戶；平台 DB 沒有租戶時登記預設租戶 |
| `pnpm db:seed` | 第一位平台管理者；每個 `active`、`disabled` 租戶補權限目錄與系統角色；`SUPER_ADMIN_EMAIL` 只建在 `SEED_TENANT` |
| `pnpm db:seed:dev`、`db:seed:e2e` | `SEED_TENANT` 一個租戶 |
| `pnpm db:reset` | 清空平台 DB 的協定狀態與 session，以及每個租戶的業務資料（production 禁止） |
| `pnpm db:archive-audit-logs` | 每個 `active` 租戶的稽核冷熱搬移 |
| `pnpm db:drop-tenant` | §5 的清除 |

## 9. 測試

| 層 | 涵蓋 |
| --- | --- |
| 單元 | `Tenancy`（狀態、版本檢查與重新檢查、`runForMaintenance`、`evict`）、`JobQueue` 對租戶不能進入的處理、`S3ObjectStorage` 的每租戶 bucket 與 presigned 網域、`MailService` 的租戶網域、`FeatureGuard`（含 `@RequireFlag`）、`PlatformTenantService.update` 的 `features` 與 `flags`（稽核、失效後發佈事件）、`FeatureFlagService` 的生效值、`PlatformFeatureFlagService`、flag 目錄的格式與到期 |
| 整合（`apps/api/test`） | `tenancy.spec.ts`（兩個租戶的帳號、token、資料互不相通；未知網域、停用、migration 落後）、`platform-tenant.spec.ts`（建立 → 佈建 → 啟用信 → 登入；網域；停用清掉 IdP 的 session；刪除後網域釋出）、`platform-admin.spec.ts`（平台管理者、稽核、背景工作、外部 IdP 開關、關掉 `file` 後 `/files` 回 404 `FEATURE_DISABLED` 與 profile 的 `features`）、`feature-flags.spec.ts`（兩級覆寫的生效值、`@RequireFlag` 端點、權限與稽核）、`route-audit.spec.ts`（`@RequireFeature` 標在哪些端點）、`sso.spec.ts`（OIDC 帶租戶） |
| E2E（`apps/e2e/tests/tenancy.spec.ts`） | 平台管理者在 apps/auth 建立租戶，第一位管理員從啟用信進入 `{code}.localhost:5173`；同一個 IdP session 換租戶要重新登入；授權碼送到別的租戶的 BFF → `AUTH_SSO_CODE_INVALID`；authorize 的租戶與 redirect URI 不一致 → `invalid_request`、沒有授權碼；停用後網域 503 |

HTTP 整合測試一律以 `listenOnLoopback(app)` 取得 server（[`../conventions/04-testing.md`](../conventions/04-testing.md) §3）。
E2E 會 `db:reset`：跑之前一定要帶暫用 DB 的 `PLATFORM_DATABASE_URL`、`DEFAULT_TENANT_*`，否則會清空共用的開發資料庫。

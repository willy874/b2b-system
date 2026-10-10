# 租戶生命週期擴充（試用期、唯讀停權、排程清除、離開前的匯出）

- 優先度：P2
- 狀態：提案
- 依賴：租戶的生命週期與 `Tenancy`（[`05-tenancy.md`](../architecture/05-tenancy.md) §3、§5、§10.2 D13）；
  清除腳本 `apps/api/src/db/drop-tenant.ts`；背景工作（[`backend/10-jobs.md`](../architecture/backend/10-jobs.md)）；
  匯出框架（[`backend/22-data-transfer.md`](../architecture/backend/22-data-transfer.md)）；平台的權限目錄與稽核（[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8）
- 相關：[`tenant-plans.md`](./tenant-plans.md)（試用可能是方案的屬性）；[`support-access.md`](./support-access.md)、[`maintenance-broadcast.md`](./maintenance-broadcast.md)（同樣需要「擋寫入」，可能共用 §2 的唯讀機制）；
  [`platform-dual-approval.md`](./platform-dual-approval.md)（刪除、立即清除、匯出全部資料的雙人覆核）；[`platform-job-management.md`](./platform-job-management.md)（清除工作的檢視與重試）；
  [`platform-dashboard.md`](./platform-dashboard.md)（試用即將到期、等待清除的租戶數）；[`platform-security-policy.md`](./platform-security-policy.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

現在租戶的狀態是 `tenant_status`（`provisioning`、`active`、`disabled`、`failed`，`apps/api/src/db/platform/schema/tenants.ts`）加上 `deleted_at` 標記；
`Tenancy.enter()` 只放行 `active`（`apps/api/src/core/tenant/tenancy.service.ts`），其他一律 `503 TENANT_UNAVAILABLE`（`reason: inactive`）。
刪除只標記並釋出網域（`PlatformTenantService.remove`），真正的清除靠在主機上手動執行 `pnpm db:drop-tenant`（[`05-tenancy.md`](../architecture/05-tenancy.md) §5、§8、§10.2 D13）。實際營運會卡在：

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 給潛在客戶 30 天試用 | 平台管理者自己記到期日，到期手動停用 | 沒有到期日欄位；忘記就一直免費用；租戶管理員事前不知道何時到期 |
| 客戶欠款，要「暫停但不刪」 | 停用（`disabled`） | 停用＝網域 503、撤銷所有 session：客戶連自己的資料都看不到、也匯不出來，談判空間只剩全有或全無 |
| 刪除後一段時間要清乾淨（個資、合約） | 有主機 shell 的人逐一跑 `db:drop-tenant --confirm` | 沒人記得就永遠留著 database 與 bucket；也沒有「保留 N 天」的規則可說明 |
| 誤刪租戶，客戶要求救回 | 沒有端點；代碼與網域已被釋出 | 只能直接改平台 DB，或從備份還原（[`01-system.md`](../architecture/01-system.md) §4.5） |
| 客戶解約前要拿走全部資料 | 租戶管理員逐一在列表頁匯出（`dataTransfer`）；檔案只能一個一個下載 | 只涵蓋已登記的資源（[`backend/22-data-transfer.md`](../architecture/backend/22-data-transfer.md) §2 的「不做」：系統設定、檔案清單、Webhook…）；沒有「整個租戶」的打包 |

## 範圍

範圍大，建議拆成四個階段，各自可以單獨上線：

| 階段 | 做 | 不做（這一版） |
| --- | --- | --- |
| 1. 唯讀機制與唯讀停權 | 租戶層的寫入限制（§2）：api 統一擋寫入、例外清單、前端的橫幅與按鈕；平台管理者手動切換 | 單一使用者或單一 feature 的唯讀；依資源的細粒度凍結 |
| 2. 排程清除與復原 | 刪除後保留 N 天、期滿由背景工作清除（§4）；保留期間可以復原；`db:drop-tenant` 改成呼叫同一份程式 | 清除後的資料救回（只能靠備份）；跨叢集搬移租戶 |
| 3. 試用期 | 到期日、到期前通知（租戶管理員與平台）、到期自動轉唯讀或停用（§3） | 付款、帳單、自助延長；方案與配額的範本（交給 [`tenant-plans.md`](./tenant-plans.md)） |
| 4. 離開前的匯出 | 整個租戶的資料打包下載（§5），唯讀與停用期間都能做 | 匯入到另一個租戶、跨平台搬家的格式承諾 |

## 使用者故事

**作為平台管理者，我希望把欠款的租戶改成唯讀，以便客戶仍能登入查看與匯出資料，但不能繼續使用。**

- **Given** 租戶 `acme` 是 `active`，有使用者正在編輯資料
- **When** 我在租戶詳情按「改為唯讀」，原因選「付款逾期」
- **Then** 之後所有寫入請求回 `409 TENANT_READ_ONLY`；backstage 頂端出現橫幅說明原因與聯絡方式，新增、編輯、刪除的按鈕隱藏；使用者仍能登入、瀏覽、匯出；平台稽核記下 `tenant.restrict`

**作為租戶管理員，我希望試用到期前收到提醒，以便決定是否續約。**

- **Given** 租戶的試用到期日是 10 月 31 日，到期動作是「轉唯讀」
- **When** 10 月 17、24、30 日
- **Then** 有 `user:update`（暫定，見開放問題 6）的人收到站內通知與 email；平台上有 `tenant:update` 的管理者收到平台通知；31 日到期後租戶自動轉唯讀，稽核的執行者是 `system`

**作為平台管理者，我希望刪除的租戶保留 30 天後自動清除，期間可以救回，以便誤刪有退路、也不必有人記得去清。**

- **Given** 租戶在 10 月 1 日刪除，保留期 30 天
- **When** 10 月 10 日客戶要求救回
- **Then** 我按「復原」：代碼與主要網域沒被別人用走時恢復成 `disabled`，並補跑 migration；10 月 31 日之後由背景工作 `tenant.purge` 清除 database、DB 角色、bucket、IdP 殘留與佇列，結果在背景工作列表與平台稽核看得到

**作為即將解約的租戶管理員，我希望一次下載整個租戶的資料，以便移轉到其他系統。**

- **Given** 租戶已轉唯讀
- **When** 我在「系統設定」按「匯出全部資料」
- **Then** 背景工作打包每種資源的 CSV 與所有檔案，完成後站內通知附下載連結（有效期限內可重下載）

## 初步構想

### 1. 狀態機

```
  provisioning ──▶ active ◀──解除──▶ restricted（唯讀）
       │            │  ▲                 │
       ▼            │  └──啟用── disabled ◀┘ 停用
     failed         │                ▲
                    └──刪除──▶ deleted（等待清除）──期滿或立即清除──▶ purging ──▶ purged
                                  │ 復原 ──▶ disabled
```

- **唯讀要不要是新的 `tenant_status` 值**是開放問題 1。上圖以 `restricted` 示意；另一個選項是 `status` 不變、另加正交的寫入限制欄位。
- `deleted`、`purging`、`purged` 目前只有 `deleted_at` 一欄；排程清除至少需要 `purge_after`（何時清）與清除結果（見 §4）。
- 試用期不是狀態，是 `active` 上的到期日（§3），到期時觸發一次轉換。

### 2. 唯讀（階段 1）

**資料模型（平台 DB，`tenants`）**：`write_restriction`（`null` ｜ `readOnly`，或新 enum 值，見開放問題 1）、`restriction_reason`（`payment` ｜ `trialExpired` ｜ `pendingDeletion` ｜ `other`）、
`restriction_note`（給租戶看的說明）、`restricted_at`、`restricted_by`。隨 `TenantDirectory` 進到 `TenantContext`（新增 `readOnly` 欄位），變更時 `invalidate()` ＋ 廣播（頻道 `tenant_directory`，同 §5.1 的 `features`）。

**api 怎麼統一擋寫入**：

| 方案 | 做法 | 優點 | 缺點 |
| --- | --- | --- | --- |
| A. 全域 guard 依 HTTP 方法 | `TenantWriteGuard`（`APP_GUARD`，排在 `FeatureGuard` 之後、`PermissionsGuard` 之前；`external-api.module.ts` 也掛）：`POST`／`PUT`／`PATCH`／`DELETE` 一律拒絕，除非路由標 `@AllowWhenReadOnly('<理由>')` | 新端點預設被擋（與「沒宣告權限就啟動失敗」同一種預設拒絕）；不必逐一改 service | 有不少「用 POST 的讀取」要標例外（見下表）；背景工作與 ws 不經 HTTP guard |
| B. 依權限鍵遮罩 | `getEffectivePermissionKeys` 只回讀取類的鍵（以權限目錄的動作分類） | 前端的按鈕自動隱藏 | 個人範圍的寫入（留言、通知已讀、偏好）不經權限鍵；資料夾授權（resource grants）另走一條；判斷分散 |
| C. 資料庫層 | `ALTER DATABASE <租戶> SET default_transaction_read_only = on` ＋ `Tenancy.evict` | 每個租戶一個 database 才做得到；任何漏網的寫入都會在 Postgres 失敗 | 只是預設值，可被 `SET TRANSACTION READ WRITE` 覆寫；登入、稽核等必要寫入要逐一明示讀寫交易；錯誤訊息不友善 |

傾向 A 為主、B 只用於前端呈現（開放問題 2）。C 可當縱深防禦，但不作為唯一機制。

**例外清單（唯讀時仍要能寫入的地方）**——用 A 時要一一標記或確認：

| 類別 | 端點或寫入 | 傾向 |
| --- | --- | --- |
| 登入本身 | `POST /auth/login`、`/auth/refresh`、`/auth/logout`、`/auth/sso/callback`、SSO 與 MFA 的互動端點（`sso-interaction.controller.ts`、`mfa-interaction.controller.ts`）；連帶寫入 `users.last_login_at`、`refresh_tokens`、登入失敗計數、平台 DB 的 `oidc_payloads` | 放行（不放行就等於停用） |
| 稽核 | 登入、拒絕存取等寫 `audit_logs` | 放行：稽核不是業務寫入 |
| 用 POST 的讀取 | `POST /file-folders/paths`、`/data-transfers/importers/:type/analyze`、`…/validate`、`/data-transfers/:id/download`、`/mfa/policy/preview`、`/announcements/audience-preview`、`…/recurrence-preview` | 放行（無副作用） |
| 匯出 | `POST /data-transfers/exports`（寫 `data_transfers`、`job_outbox`、bucket 的物件、完成通知） | 放行：唯讀的主要目的就是讓客戶拿走資料 |
| 個人狀態 | 通知已讀（`/notifications/read-all`、`/:id/read`）、`PATCH /auth/profile` 的語系與時區 | 開放問題 3 |
| 帳號安全 | `change-password`、`reset-password`、`forgot-password`、MFA 的自助設定（`mfa-self.controller.ts`）、`setup`（啟用 `pending` 帳號） | 開放問題 3 |
| 系統的寫入 | 用量計數（平台 DB）、速率限制計數（平台 DB）、`job_outbox` 的搬移 | 不受影響（不在 HTTP guard 範圍） |

- 錯誤碼 `TENANT_READ_ONLY`（409；`details.reason`），走 `packages/error-codes` ＋ `web-core` 的 `ERROR_MESSAGE_KEY` 與語系檔。
- **直傳物件儲存**：切換前已簽出的上傳網址在效期內仍能 PUT，但完成上傳的 `POST /files/:id/complete` 會被擋，物件由檔案維護的對帳清掉（[`backend/09-file.md`](../architecture/backend/09-file.md) §9）。
- **WebSocket**：ws 訊息不經 HTTP 的方法判斷；`realtime.gateway.ts` 現有的 `@SubscribeMessage`（`SESSION_RENEW`、`CHANNEL_RELAY`）要逐一確認有沒有寫入租戶 DB，有的話在 `WsAuthGuard` 同樣判斷。
- **背景工作**：`forEachActive`、排程展開（`core/jobs/job-queue.ts`）、`TenantDirectory.listActive` 都只看 `active`。唯讀的租戶哪些工作要跑是開放問題 4：
  保留期限的清理（`trash.purge`、`auditLog.archive`）、匯出、寄信要跑；公告的排程發送、Webhook 投遞、審批的提醒是否暫停要決定。
- **路由稽核**：`common/route-audit.ts` 可以加一條「非 GET 的路由若標了 `@AllowWhenReadOnly` 必須附理由」，並在測試裡列出所有例外，新增例外要在 review 時看得到。

**前端**：`/auth/profile` 多一個 `tenant: { readOnly: { reason, note, since } | null }`。web-core 的外框（`layout/DashboardShell.tsx`）顯示不可關閉的橫幅；
`usePermission()` 的寫入類判斷回 false（方案 B 的前端部分），按鈕照現有的權限判斷自然隱藏；漏網的按鈕送出時，全域錯誤處理把 `TENANT_READ_ONLY` 顯示成 toast。
切換時推 `resource.changed`（同 `TENANT_FEATURES_CHANGED`），前端重新取得 profile。

### 3. 試用期（階段 3）

- **資料模型（`tenants`）**：`trial_ends_at`（null＝不是試用）、`trial_expiry_action`（`readOnly` ｜ `disable`）、`trial_notified`（已發過的提醒天數，避免重發）。
  若 [`tenant-plans.md`](./tenant-plans.md) 先做，試用天數與到期動作可以是方案的預設值，這裡只存「這個租戶的實際到期日」。
- **平台工作 `tenant.lifecycleSweep`**（每小時）：到期前 14／7／1 天各發一次提醒；到期時依 `trial_expiry_action` 轉換，稽核的執行者是 `system`；結束試用（轉正式）＝清掉 `trial_ends_at`。
- **通知**：租戶這邊在租戶脈絡裡 `NotificationService.notify`（新的通知類型，照 [`backend/15-notification.md`](../architecture/backend/15-notification.md) §9）＋ email（到期轉停用後站內通知看不到）；
  收件人以 `PermissionService.findActiveUserIdsWithPermission` 找（哪個鍵見開放問題 6）。平台這邊 `PlatformNotificationService.notifyHolders`（同 `tenant.storageNearQuota` 的做法，[`05-tenancy.md`](../architecture/05-tenancy.md) §5.4）。
- 租戶清單加「試用到期」欄與篩選；租戶的 backstage 顯示剩餘天數（不可關閉的提示，與唯讀橫幅同一個位置）。

### 4. 排程清除與復原（階段 2）

**現況**：`apps/api/src/db/drop-tenant.ts` 依序 ① 清空並刪除 bucket（自建 `S3Client`）② 以 `TENANT_PROVISIONING_DATABASE_URL` `DROP DATABASE … WITH (FORCE)`、佈建產生的才 `DROP ROLE`
③ 平台 DB 的交易：刪 `oidc_payloads`（`tenantAccountPrefix`）、刪 `pgboss.job` 裡 `data->>'tenantId'` 相符的工作、刪 `tenants` 列（`tenant_domains`、`tenant_usage_daily` 隨外鍵 cascade）、寫平台稽核 `tenant.purge`。

**改成背景工作**：

- 把 ①–③ 抽成一個不依賴 CLI 的清除程式（例如 `modules/tenant/tenant-purger.ts`），CLI 與背景工作共用；bucket 改用 `ObjectStorage`，不再自建 client。
- 平台工作 `tenant.purgeSweep`（每天）找 `deleted_at IS NOT NULL AND purge_after <= now()` 的租戶，各入列一筆 `tenant.purge`（`scope: 'platform'`，不自動重試或有限重試）。
- **每一步冪等**（沿用 `IF EXISTS`、`NoSuchBucket` 略過），失敗停在「清除失敗」並記原因，可以從平台重試；先 `Tenancy.evict` 再 DROP。
- 預設租戶（`db:migrate` 登記、database 不是佈建產生的）不自動清除，維持 CLI 的 `--database` 確認。
- **清除後要不要留一列墓碑**（`purged_at`，保留代碼、刪除與清除時間，不留連線字串）是開放問題 7：現在刪列會連帶刪掉用量歷史。
- **目前沒有清到的東西**：`mfa_channel_links`（`tenant_id` 沒有外鍵，靠過期清理）、CDN 邊緣快取（[`backend/09-file.md`](../architecture/backend/09-file.md) §16；網址會過期，但快取占用到 inactive 期滿）、`job_outbox` 在租戶 DB 內隨 database 消失。改成背景工作時一併列清單。

**資料模型（`tenants`）**：`purge_after`（刪除時 = `deleted_at` + 保留天數）、`purge_status`（`pending` ｜ `running` ｜ `failed`）、`purge_error`。保留天數由環境變數（如 `TENANT_PURGE_RETENTION_DAYS`）給預設，刪除時可以選更短或「不自動清除」。

**復原**：`POST /platform/tenants/:id/restore`，只接受已刪除、尚未開始清除的租戶：

- 代碼在刪除時已釋出（`tenants_code_key` 只約束未刪除的列），可能已被新租戶使用 → `409 TENANT_CODE_TAKEN`，或復原時改代碼。
- 網域在刪除時由 `removeAllDomains` 移除（平台稽核 `tenant.delete` 的 `metadata.domains` 有記錄）：復原時重新登記，被占用的略過並列出。
- `db:migrate` 不處理已刪除的租戶（`db/migrate.ts`）：復原後 database 可能落後，要先補跑 migration（比照「重試佈建」），完成前 `Tenancy.enter` 回 `maintenance`。
- 復原後是 `disabled`，由平台管理者再啟用；不自動恢復成刪除前的狀態。

### 5. 離開前的匯出（階段 4）

| 方案 | 內容 | 優點 | 缺點 |
| --- | --- | --- | --- |
| A. 沿用 data-transfer | 新的工作逐一呼叫已登記的 Exporter（CSV），加上 bucket 內的檔案（依資料夾結構），打包成 zip | 格式客戶看得懂；權限、欄位與遮罩沿用 | 只涵蓋已登記的資源（系統設定、Webhook、審批流程等不在內，[`backend/22-data-transfer.md`](../architecture/backend/22-data-transfer.md) D46、D47）；`exportMaxRows` 上限要另外處理 |
| B. `pg_dump` ＋ 物件 | 租戶 database 的 dump 與整個 bucket | 完整、與備份同一套（[`01-system.md`](../architecture/01-system.md) §4.5） | 內部 schema 不是對客戶的承諾；含平台金鑰加密的欄位（IdP 的 client secret、Webhook secret、MFA 秘密、密碼雜湊）要剔除或說明；只能由平台執行 |
| C. 兩者 | 客戶自助拿 A；平台應客戶或法務要求另做 B | 各取所需 | 兩套都要維護 |

- 傾向 A 由租戶管理員自助（唯讀期間也能用），B 不對外提供（開放問題 8）。
- 打包檔放哪裡：租戶的 bucket 會在清除時消失，期滿前要下載；需要時放平台層的暫存 bucket 並設效期。
- 大小：打包是串流寫 zip，不在記憶體組裝；檔案總量受 `file.storageQuotaMb` 限制。
- 停用的租戶連不上網域，自助匯出做不到：要嘛停用前先轉唯讀，要嘛由平台代為產生（牽涉平台能否讀租戶資料，見 [`support-access.md`](./support-access.md) 與 [`05-tenancy.md`](../architecture/05-tenancy.md) §10.2 D19）。

### 6. 權限（平台的目錄）

| 權限鍵 | 說明 | `super-admin` | `operator` | `auditor` |
| --- | --- | :-: | :-: | :-: |
| `tenant:update`（既有） | 加上：改為唯讀與解除、試用到期日與到期動作 | ✅ | ✅ | |
| `tenant:delete`（既有） | 加上：刪除時選保留天數 | ✅ | | |
| `tenant:restore`（新） | 保留期間復原刪除的租戶 | ✅ | 開放問題 9 | |
| `tenant:purge`（新） | 立即清除（不等保留期滿）、重試失敗的清除 | ✅ | | |
| `tenant:export`（新，若做方案 B 或平台代為匯出） | 產生並下載整個租戶的資料 | ✅ | | |

租戶的目錄（[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §2）：「匯出全部資料」可能需要新的鍵（例如 `system:exportAll`），或限定 super-admin；開放問題 6。

### 7. 稽核與通知

| 動作（平台稽核） | 內容 | `severity` |
| --- | --- | --- |
| `tenant.restrict`／`tenant.unrestrict` | 原因、說明、執行者（含 `system`） | `high` |
| `tenant.trial.update` | 到期日、到期動作的 `before`／`after` | `normal` |
| `tenant.trialExpired` | 執行者 `system`、套用的動作 | `high` |
| `tenant.delete`（既有） | 加上 `purgeAfter` | `high` |
| `tenant.restore` | 恢復的代碼、重新登記與略過的網域 | `high` |
| `tenant.purge`（既有，CLI 已寫） | 加上觸發方式（排程／立即／CLI）、每一步的結果 | `high` |
| `tenant.export` | 只有平台代為匯出時才寫 | `high` |

租戶的稽核另記「租戶被改為唯讀／解除」（執行者顯示為平台），讓租戶管理員看得到發生過什麼——平台動作寫進租戶稽核目前沒有先例（D19），開放問題 10。

### 8. 端點（apps/platform）

| 方法 | 路徑 | 權限 | 說明 |
| --- | --- | --- | --- |
| POST | `/platform/tenants/:id/restrict` | `tenant:update` | `{ reason, note }`；只接受 `active` |
| POST | `/platform/tenants/:id/unrestrict` | `tenant:update` | 回到 `active` |
| PATCH | `/platform/tenants/:id` | `tenant:update` | 加 `trialEndsAt`、`trialExpiryAction` |
| DELETE | `/platform/tenants/:id` | `tenant:delete` | 加 `purgeAfterDays`（或 `null`＝不自動清除） |
| POST | `/platform/tenants/:id/restore` | `tenant:restore` | 見 §4 |
| POST | `/platform/tenants/:id/purge` | `tenant:purge` | 立即清除，`202 { jobId }`；需雙人覆核時回「待覆核」 |

狀態不允許時沿用 `409 TENANT_STATUS_CONFLICT`；租戶清單的 `status` 篩選加上新狀態，並可列出「已刪除、等待清除」的租戶（現在 `GET /platform/tenants` 只回未刪除的）。

### 9. 危險操作與雙人覆核

刪除、立即清除、平台代為匯出是本功能最危險的三個動作。[`platform-dual-approval.md`](./platform-dual-approval.md) 若先做，這三個端點改成「提出 → 另一位管理者核准 → 執行」；
若還沒做，最低限度是 `super-admin` 限定 ＋ 輸入租戶代碼確認。排程清除本身（保留期滿）不需要再覆核：覆核發生在刪除那一刻，期滿只是執行當時的決定。

### 10. 會動到的既有檔案

| 位置 | 改動 |
| --- | --- |
| `apps/api/src/db/platform/schema/tenants.ts` | 狀態或寫入限制欄位、試用欄位、清除欄位（下一個平台 migration；enum 加值要注意 `migrations:check`） |
| `apps/api/src/core/tenant/tenancy.service.ts` | `enter()` 放行唯讀的租戶；`TenantContext` 加 `readOnly` |
| `apps/api/src/core/tenant/tenant-directory.service.ts`、`tenant.repository.ts` | `listActive` 是否包含唯讀的租戶（影響 `forEachActive`、排程展開、`s3-object-storage.ts`、MFA 與 feature flag 的廣播） |
| `apps/api/src/modules/oidc-provider/oidc-provider.service.ts` | 兩處 `tenant.status !== 'active'` 的登入判斷要放行唯讀 |
| `apps/api/src/common/guards/`、`app.module.ts`、`external-api.module.ts`、`common/route-audit.ts` | 新的寫入 guard、`@AllowWhenReadOnly` 與路由稽核 |
| `apps/api/src/modules/tenant/`（`platform-tenant.service.ts`、controller、新的 purger 與 sweep） | 唯讀、試用、復原、清除 |
| `apps/api/src/db/drop-tenant.ts` | 改呼叫共用的清除程式 |
| `apps/api/src/db/client.ts`、`db/migrate.ts` | 腳本的租戶範圍（`activeOnly`／`includeDisabled`）加上新狀態；復原時的 migration |
| `modules/data-transfer` | 「匯出全部」的工作（階段 4） |
| `packages/error-codes`、`packages/web-core`（`layout/`、`permission/`、`errors/`） | `TENANT_READ_ONLY`、橫幅、寫入判斷 |
| `apps/platform/src/features/tenant` | 唯讀、試用、復原、清除的操作與狀態顯示 |
| `seeds/platform-permissions.ts`、`iam/02-permission-catalog.md` §8 | 新的平台權限鍵 |

## 開放問題

進入「規劃中」之前，每一條都要有結論（寫在該條下方，不要刪掉問題）。

1. **唯讀是新的 `tenant_status` 值，還是正交的寫入限制欄位？** 新狀態值簡單、清單篩選直覺，但 `Tenancy.enter`、`listActive`、腳本、oidc-provider 每一處 `=== 'active'` 都要改成「可服務的狀態」；
   正交欄位讓 `active` 的語意不變，也能讓 [`maintenance-broadcast.md`](./maintenance-broadcast.md) 的全平台維護與這裡共用同一個判斷（原因不同）。傾向正交欄位。
2. **api 擋寫入的主要機制**：§2 的 A（依 HTTP 方法＋例外標記）、B（權限遮罩）、C（資料庫層）。傾向 A 為準、B 只給前端、C 視需要當縱深防禦。
   [`support-access.md`](./support-access.md) 的唯讀支援 session 是「這個 session 唯讀」而不是「這個租戶唯讀」，guard 與 `@AllowWhenReadOnly` 是否共用、判斷來源如何合併要一起決定。
3. **唯讀時個人狀態與帳號安全的寫入**（通知已讀、偏好、改密碼、MFA 設定、啟用 `pending` 帳號）放不放行？傾向放行安全相關與個人狀態，不放行啟用新帳號（等同新增使用者）。
4. **唯讀租戶的背景工作**：保留期限的清理、匯出、寄信照跑；公告排程、Webhook 投遞、審批相關的排程要不要暫停？暫停期間錯過的要不要補？傾向暫停會「對外產生效果」的（Webhook、公告），比照 feature 關閉時「期間的事件不補送」（[`05-tenancy.md`](../architecture/05-tenancy.md) §5.1）。
5. **試用到期的預設動作**：轉唯讀還是停用？轉唯讀對客戶友善（還能匯出），停用比較乾脆。傾向轉唯讀，再過一段寬限期（例如 30 天）自動停用，是否要第二段由 [`tenant-plans.md`](./tenant-plans.md) 一起決定。
6. **租戶這邊誰收試用提醒、誰能「匯出全部資料」**：以權限鍵找（哪一個？`system:update`？）、只給 super-admin，或新增一個鍵？傾向匯出全部只給 super-admin（資料量與敏感度都最高）。
7. **清除後要不要留墓碑列**：留下 `tenants` 的一列（代碼、刪除與清除時間，清空連線字串與 bucket）保住平台稽核的對照與用量歷史；或照現在整列刪除。傾向留墓碑、用量歷史另依保留期限刪。
8. **離開前的匯出要做到哪一層**：§5 的 A、B、C。傾向 A 自助；B 不提供給客戶，只在平台的維運手冊說明怎麼從備份取出單一租戶。
9. **復原的權限與限制**：`operator` 能不能復原？代碼已被占用時改代碼還是拒絕？保留天數的預設值（30？90？）與上限？傾向只給 `super-admin`、代碼被占用就拒絕、預設 30 天。
10. **平台的動作要不要寫進租戶的稽核**：改唯讀、試用到期這類影響租戶的動作，租戶管理員目前只能從橫幅得知。寫進租戶的 `audit_logs` 會打破「平台與租戶的稽核互相看不到」（[`05-tenancy.md`](../architecture/05-tenancy.md) §10.2 D19）的對稱，但資訊對租戶有用。傾向寫一筆執行者為「平台」、不帶平台管理者身分的紀錄。
11. **保留期間的資料還算不算「租戶的資料」**：刪除後 database 與 bucket 仍在，期間是否計入儲存止水線（`storage.totalRollup` 現在只看 `active`）？傾向計入，避免大量刪除的租戶在清除前擠爆容量時看不到。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

完成後預計寫成：

- `docs/architecture/05-tenancy.md` §5 的生命週期（狀態機、唯讀、試用、排程清除、復原）與 §8 的腳本；設計決策新增一章
- `docs/architecture/backend/` 新的一節或文件：唯讀機制（guard、例外標記、背景工作的處理），若與 [`support-access.md`](./support-access.md)、[`maintenance-broadcast.md`](./maintenance-broadcast.md) 共用則寫成一份
- `docs/architecture/backend/22-data-transfer.md`：「匯出全部資料」
- `docs/architecture/iam/02-permission-catalog.md` §8：`tenant:restore`、`tenant:purge`（與 `tenant:export`）
- `docs/architecture/01-system.md` §4.5：「無法復原的操作」加入排程清除
- [`../../CLAUDE.md`](../../CLAUDE.md) 的 `db:drop-tenant` 說明

# 跨租戶查使用者與救援

- 優先度：P1
- 狀態：提案
- 依賴：租戶的進入與連線（[`05-tenancy.md`](../architecture/05-tenancy.md) §3 的 `Tenancy`）；平台的權限目錄與稽核（[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8、[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §8.1）；
  租戶端既有的救援動作（[`backend/04-auth.md`](../architecture/backend/04-auth.md) §3.3、§5，[`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §8）
- 相關：[`support-access.md`](./support-access.md)（代理登入：本提案只做「查與單點救援」，不進入租戶的畫面）；
  [`platform-dual-approval.md`](./platform-dual-approval.md)（重設 MFA、產生重設連結是否要雙人覆核）；
  [`platform-security-policy.md`](./platform-security-policy.md)（平台後台的 IP 白名單與 session 時效，決定這些動作能從哪裡做）；
  [`platform-dashboard.md`](./platform-dashboard.md)（查不到的租戶多半是 migration 落後）；[`tenant-lifecycle.md`](./tenant-lifecycle.md)（停用、唯讀停權中的租戶要不要能查）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

每個租戶一個 database（[`05-tenancy.md`](../architecture/05-tenancy.md) §1），使用者只存在各租戶 DB 的 `users`。
平台管理者因此 **完全看不到** 租戶的使用者：[`05-tenancy.md`](../architecture/05-tenancy.md) §10.2 D11 明文「apps/platform 不列出一個人屬於哪些租戶」，
D19 規定「平台管理者看不到租戶的稽核」。這在租戶自己能處理時沒問題，但支援工作常卡在租戶處理不了的情況：

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 使用者來信「我登不進去」，只給 email、沒說是哪個租戶 | 請他找自己公司的管理員；或拿 email 逐一問各租戶 | 平台不知道這個 email 在哪些租戶有帳號；同一個 email 在不同租戶是不同帳號（[`04-sso.md`](../architecture/04-sso.md) §1.1） |
| 租戶唯一的 super-admin 被鎖、忘記密碼、弄丟 MFA 手機，而且收不到信 | 有主機權限的人跑 `cli:reset-super-admin`（[`iam/05-bootstrap.md`](../architecture/iam/05-bootstrap.md) §7，`--reset-mfa` 見 [`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §8） | 要 shell 與資料庫存取權；值班的平台管理者自己做不了；只限直接持有 `super-admin` 的人 |
| 一般使用者被鎖定（`locked_until` 未到期），租戶管理員剛好也是被鎖的那位 | 等 `auth.loginLockoutSeconds` 到期 | 沒有其他人能在租戶內解鎖（`POST /users/:id/unlock` 要 `user:update`） |
| 疑似帳號被盜，要立刻把某人踢下線 | 租戶管理員停用帳號再啟用（`user.service.ts` 的 `updateInTx` 停用時 `revokeAllForUser`），或改密碼 | 租戶端 **沒有單純的「撤銷 session」**；停用會改狀態、推通知，事後還要記得啟用 |
| 平台想知道「這個人的外部身分連到哪個 IdP、有沒有設 MFA」來判斷問題出在哪 | 請租戶管理員截圖 `GET /users/:userId/identities`、`GET /users/:id/mfa` 的畫面 | 來回溝通；平台與租戶各看到一半 |

另一方面，這些動作 **不能毫無邊界地搬到平台**：使用者的 email、姓名、登入時間是租戶的個資；平台對租戶使用者做的事，租戶管理員必須看得到
（現在平台的動作只寫 `platform_audit_logs`，租戶看不到，[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §8.1）。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| apps/platform 的「租戶使用者」頁：以 email（完整或部分字串）跨租戶查詢，列出每個租戶的符合帳號 | 列出某租戶的全部使用者、依姓名或使用者名稱搜尋（那是租戶後台的事） |
| 每個帳號的摘要：租戶、顯示名稱、狀態（`pending`／`active`／`inactive`，鎖定中顯示 `locked`）、最後登入、MFA 是否設定與方式、外部身分（連線名稱、協定、最後登入）、是否持有 super-admin | 查看角色、權限、群組、檔案等業務資料；有效權限的說明（[`iam/08-explain.md`](../architecture/iam/08-explain.md)） |
| 救援動作：解鎖、寄重設密碼信（`pending` 改寄啟用信）、重設 MFA、撤銷 session（強制登出） | 改密碼、改 email、啟用被停用的帳號、改角色；代理登入（[`support-access.md`](./support-access.md)） |
| 「產生一次性連結」取代 `cli:reset-super-admin` 的情境（信寄不到時），條件與門檻見開放問題 3 | 移除 CLI：平台本身壞掉、或平台管理者自己全部被鎖時仍要它 |
| 平台稽核（查詢、檢視、每個動作）＋ 租戶稽核（每個動作，標明來自平台） | 讓租戶管理員看平台稽核的全文（只寫進租戶自己的 `audit_logs`） |
| 租戶端補一個「撤銷 session」動作（三處同步，平台與租戶共用同一個 service） | 外部身分的解除（租戶端已有 `DELETE /users/:userId/identities/:identityId`，平台不做） |
| 查詢的效能邊界：只查 `active` 且 migration 對上的租戶、有並行上限與逾時，無法查詢的租戶列在結果裡 | 停用、佈建中、已刪除租戶的使用者（等 [`tenant-lifecycle.md`](./tenant-lifecycle.md) 決定唯讀停權的語意） |
| 服務帳號（`kind = 'service'`）排除在外 | 平台管理者帳號的救援（已有 `/platform/admins/*`） |

## 使用者故事

**作為值班的平台管理者，我希望只憑 email 就找到這個人在哪些租戶有帳號，以便不必逐一詢問租戶。**

- **Given** `alex@example.com` 在租戶 `acme` 是 `active`、在 `beta` 是 `pending`；租戶 `gamma` 正在 migration 落後
- **When** 我在「租戶使用者」頁輸入 `alex@example`
- **Then** 結果列出 `acme`、`beta` 兩列與各自的狀態、最後登入、MFA；另有一行「1 個租戶暫時無法查詢：gamma（維護中）」；平台稽核記一筆 `tenantUser.search`

**作為平台管理者，我希望在租戶唯一的 super-admin 弄丟 MFA 裝置時直接從畫面重設，以便不必找有主機權限的人跑 CLI。**

- **Given** `acme` 只有一位 super-admin，他的手機遺失、備用碼也找不到
- **When** 我在他那一列按「重設 MFA」，輸入理由（例：「工單 #1234，已電話核對身分」）並確認
- **Then** 他的驗證方式與備用碼被刪除、所有 session 結束（`token_version + 1`）、本人收到通知信；
  `acme` 的稽核出現 `user.mfa.reset`，操作者顯示為「平台：ops@example.com」並帶理由；平台稽核記一筆 `tenantUser.resetMfa`

**作為租戶的 super-admin，我希望看得到平台對我們的使用者做過什麼，以便確認沒有越權。**

- **Given** 平台管理者昨天解鎖了我們的一位使用者
- **When** 我在 backstage 的稽核日誌以 `user.*` 篩選
- **Then** 看到 `user.unlock`，操作者標示為平台、帶平台管理者的 email 與理由；不需要任何平台權限

**作為平台管理者，我希望在疑似帳號被盜時立刻把某人踢下線，而不改他的帳號狀態，以便租戶管理員之後再決定要不要停用。**

- **Given** 某租戶回報一位使用者的帳號有異常登入
- **When** 我按「撤銷 session」
- **Then** 他所有的 refresh 家族作廢、access token 失效、IdP session 與未完成的登入互動一起銷毀（[`04-sso.md`](../architecture/04-sso.md) §3.5）；狀態仍是 `active`

## 初步構想

### 1. 查詢怎麼跑

```
GET /platform/tenant-users?email=<字串>
  ├─ 驗證：完整 email，或部分字串至少 3 個字元（pg_trgm 的下限）
  ├─ 取得要查的租戶：TenantDirectory.listActive()（或索引，見開放問題 1）
  ├─ 以 createLimiter({ concurrency: N, queueTimeoutMs }) 並行進入：Tenancy.run(id, () => repo.findByEmail(...))
  │     每個租戶有逾時；失敗、503（inactive／maintenance）不中斷，收進 `unavailable`
  └─ 回應：{ results: [{ tenant, users: [...] }], unavailable: [{ tenantCode, reason }], truncated }
```

- 每個租戶的查詢是一句 `SELECT … FROM users WHERE deleted_at IS NULL AND kind = 'human' AND email::text ILIKE …`，
  部分字串可用既有的 `users_email_trgm_idx`（`db/schema/users.ts`），完整 email 用 `users_email_key`；每租戶最多回 10 列，總數超過 100 時 `truncated`。
- MFA 讀 `users.mfa_enabled` 與 `mfa_factors` 的方式（不含機密）；外部身分讀 `user_identities` ＋ 連線名稱；super-admin 以 `PermissionService.getPermissionSet` 判斷。
  摘要只在「展開某一列」時查，列表只帶 `users` 的欄位，減少每個租戶的查詢數。
- **效能的量級**：`Tenancy.forEachActive` 是依序的，200 個租戶 × 每個約 20–50 ms（含建立連線池、版本檢查）會到 4–10 秒；並行 8 時約 1 秒內，
  但同時打開的租戶連線池計入連線預算（[`backend/02-database.md`](../architecture/backend/02-database.md) §6.2：`同時活躍的租戶數 × TENANT_POOL_MAX`）。
  所以查詢只用每個租戶 **一條** 連線、並行數小、以 `TENANT_POOL_IDLE_TIMEOUT` 讓池子自己關掉；租戶數再往上就需要索引（開放問題 1）。
- 加指標（[`08-monitoring.md`](../architecture/08-monitoring.md) §2.4）：`api_tenant_user_search_duration_seconds`、`api_tenant_user_search_unavailable_total{reason}`，標籤不帶租戶。

### 2. 救援動作：在租戶脈絡裡呼叫租戶端既有的 service

| 動作 | 端點（apps/platform） | 租戶端沿用 | 租戶稽核 |
| --- | --- | --- | --- |
| 解鎖 | `POST /platform/tenants/:tenantId/users/:userId/unlock` | `UserService.unlock`（`USER_NOT_LOCKED` 照舊） | `user.unlock` |
| 寄重設密碼信 | `…/reset-password` | `UserService.resetPassword`（`pending` 改寄啟用信） | `user.reset_password_requested`／`user.activation_resent` |
| 重設 MFA | `…/mfa/reset` | `MfaService.reset('tenant', …)`（刪因子與備用碼、`token_version + 1`、寄通知信） | `user.mfa.reset`（`severity: high`） |
| 撤銷 session | `…/sessions/revoke` | **新增** `UserService.revokeSessions`：`RefreshTokenService.revokeAllForUser` ＋ `token_version + 1` ＋ 交易後 `SESSIONS_REVOKED`、`UserCacheService.invalidate()` | `user.sessions_revoked`（新） |
| 產生一次性連結 | `…/recovery-link`（見開放問題 3） | 與 `cli/reset-super-admin.ts` 相同：`issueAuthToken()`，`pending` 簽啟用連結 | `system.super_admin_reset_requested` 或新的 `user.recovery_link_issued` |

- 每個動作都以 `Tenancy.run(tenantId, …)` 進入，**請求必須帶理由**（`reason`，1–500 字），寫進兩邊的稽核。
- **操作者不是租戶的使用者**：現在 `AuditService.record` 從請求脈絡取 `ctx.user`（`modules/audit-log/audit.service.ts`），在平台的請求裡那是
  `platform_admins` 的 id，直接寫進租戶的 `audit_logs.actor_id` 會變成一個租戶裡不存在的 uuid。要明確傳入平台的操作者（開放問題 4）。
- **反提權不適用平台**：`MfaAdminService.resetUser` 以 `permissions.getPermissionSet(actor.id)` 比對操作者是否也是 super-admin，平台管理者在租戶裡沒有權限集合。
  平台路徑跳過這段，改由平台權限把關（例：對持有 super-admin 的目標，只有平台的 `super-admin` 能動手，開放問題 5）。
  所以平台端 **不直接呼叫** controller 用的 `resetUser`，而是呼叫底下的 `MfaService.reset` 並自己做平台的判斷。
- 租戶端補的 `POST /users/:id/sessions/revoke`（`user:update`，目標是 super-admin 時操作者也要是，不能對自己）共用 `revokeSessions`；backstage 使用者詳情加按鈕。

### 3. 程式放哪裡

- 後端：`modules/user/platform/`（比照既有的 `modules/user/external/`）放 `PlatformTenantUserController`（`/platform/tenants/:tenantId/users/*`、`/platform/tenant-users`）
  與 `PlatformTenantUserService`；它注入 `Tenancy`、`UserService`、`MfaService`、`PlatformAuditService`（`modules/platform-admin`）。
  `modules/user` 與 `modules/mfa`、`modules/platform-admin` 之間的依賴方向要照 [`coding-standards/07-layer-dependencies.md`](../coding-standards/07-layer-dependencies.md) §3.2 確認；
  若形成循環，改成獨立的 `modules/tenant-user-support`（只被 app module 匯入）。
- 前端：apps/platform 新 feature `features/tenant-user/`（側欄 `NavGroupKey.TENANT`，在「租戶」之下）：搜尋框、依租戶分組的結果、展開的摘要、動作對話框（理由必填、二次確認）。
  租戶詳情頁（`features/tenant/pages/TenantDetail/useTenantDetailTab.ts`）加「使用者」分頁，等同把查詢限定在這個租戶——兩處共用的元件放 `packages/web-core` 還是各自一份，照 [`frontend/17-shared-packages.md`](../architecture/frontend/17-shared-packages.md) §2 判斷（只有 apps/platform 用，留在 app）。
- 錯誤碼（`packages/error-codes`）：`TENANT_USER_QUERY_TOO_SHORT`、`TENANT_USER_SEARCH_TIMEOUT`（全部租戶都逾時）；其他沿用 `USER_NOT_FOUND`、`USER_NOT_LOCKED`、`TENANT_UNAVAILABLE`。

### 4. 權限（平台目錄，[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8）

| 權限鍵 | 說明 | `super-admin` | `operator` | `auditor` |
| --- | --- | :-: | :-: | :-: |
| `tenantUser:read` | 跨租戶查詢與檢視摘要 | ✅ | ✅ | （開放問題 2） |
| `tenantUser:unlock` | 解鎖 | ✅ | ✅ | |
| `tenantUser:resetPassword` | 寄重設密碼／啟用信 | ✅ | ✅ | |
| `tenantUser:revokeSessions` | 撤銷 session | ✅ | ✅ | |
| `tenantUser:resetMfa` | 重設 MFA | ✅ | | |
| `tenantUser:issueRecoveryLink` | 產生一次性連結（畫面顯示一次） | ✅ | | |

`seeds/platform-permissions.ts`、apps/platform 的 `permission.ts` 與兩個語系檔同步加入。

### 5. 稽核與通知

- 平台稽核（`platform_audit_logs`）：`tenantUser.search`（`metadata` 帶查詢字串的雜湊或原文——開放問題 6、符合筆數、查過與無法查的租戶數）、
  `tenantUser.view`（展開摘要）、`tenantUser.unlock`／`resetPassword`／`resetMfa`／`revokeSessions`／`issueRecoveryLink`（`resource_id` = `<tenantId>:<userId>`，帶理由；`resetMfa`、`issueRecoveryLink` 為 `severity: high`）。
- 租戶稽核（`audit_logs`）：沿用上表的既有 action，`metadata.via = 'platform'`、`metadata.platformAdminEmail`、`metadata.reason`；backstage 稽核列表依 `via` 顯示「平台」標記。
- 平台稽核與租戶稽核在 **不同的 database**，無法同一個交易：租戶的變更與租戶稽核在租戶交易內（不變），平台稽核在租戶交易提交 **之後** 寫；
  寫失敗時以 `recordSafely` 的方式記 log 與指標，不回滾租戶的變更（與停用租戶的收尾 `tenant.disable.cleanup` 同一種取捨）。
- 推播：各動作沿用租戶端已有的事件（`RESOURCE_CHANGED`、`SESSIONS_REVOKED`），backstage 開著的使用者詳情會更新。

## 開放問題

1. **要不要在平台 DB 建「email → 租戶」索引？**
   - (a) 不建，每次查詢都逐租戶進入（§1）：資料永遠正確、平台 DB 不多存個資；代價是延遲與連線隨租戶數線性成長，部分字串比對要在每個租戶各跑一次。
   - (b) 建 `tenant_user_index(email citext, tenant_id, user_id, updated_at)`：租戶端建立、改 email、刪除、還原時在交易內 `JobQueue.enqueue(..., { tx })`（`job_outbox`）由平台工作 upsert，
     另由 `tenant.usageRollup` 一類的每小時工作全量對帳（`core/usage/tenant-usage-snapshots.ts` 的走法）；查詢只碰平台 DB，再進入命中的租戶讀即時資料。代價：平台 DB 持有全部租戶的 email，
     直接推翻 [`05-tenancy.md`](../architecture/05-tenancy.md) §10.2 D11 的理由；匯入、還原、`db:drop-tenant` 每條寫入路徑都要維護，漏一條就查不到。
   - (c) 只存 email 的 HMAC（金鑰在環境變數）：只能完整比對、不能部分字串，平台 DB 外洩時不直接暴露 email。
   - 傾向 (a) 起步並加並行上限，留下 (c) 作為租戶數超過某個門檻（例：數百個）時的升級路徑；(b) 的個資成本最高。
2. **`auditor` 能不能查？** 平台 `auditor` 現在能看所有租戶的清單與用量，但看不到任何個資。可選：(a) 給 `tenantUser:read`（查詢本身就寫稽核）；(b) 不給，查詢等同存取個資，只給會動手的人。傾向 (b)。
3. **信寄不到時，畫面要不要顯示一次性連結？** CLI 的做法是印出連結交給本人。搬到畫面上等於平台管理者可以拿到連結、自己設密碼登入——與代理登入（[`support-access.md`](./support-access.md)）同等的能力。
   可選：(a) 不做，只寄信，CLI 保留；(b) 只給平台 `super-admin`，連結只顯示一次、理由必填、雙方稽核 `high`；(c) 同 (b) 再加雙人覆核（[`platform-dual-approval.md`](./platform-dual-approval.md)）。
   另一個問題是範圍：CLI 只限直接持有 super-admin 的帳號，畫面要不要開放給一般使用者（一般使用者應該找租戶管理員）。傾向 (b) 且只限 super-admin，等雙人覆核做了再接上 (c)。
4. **租戶稽核裡平台操作者的表示法**：`audit_logs.actor_id` 沒有外鍵。可選：(a) `actor_id = null`、`actor_email = 'platform:<email>'`，細節在 `metadata`；(b) 加一欄 `actor_realm`（`tenant`／`platform`／`system`）的租戶 migration，`actor_id` 存平台管理者 id；
   (c) `actor_email = 'platform'` 不揭露是誰，只在平台稽核找得到。(a) 不動 schema、租戶看得到是誰；(b) 篩選最乾淨但要改 [`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §3 的資料形狀。傾向 (a)。
5. **對持有 super-admin 的目標要多一道門檻嗎？** 租戶內的反提權規則是「動 super-admin 的人自己也要是 super-admin」。平台端可選：(a) 只看平台權限鍵；(b) 目標是 super-admin 時，`unlock` 以外的動作只給平台 `super-admin`；
   (c) 依租戶設定決定。傾向 (b)，與 `platformAdmin:resetMfa` 只給 super-admin 的考量一致。
6. **隱私界線與租戶的同意**：平台看得到租戶使用者的個資，要不要讓租戶控制？可選：(a) 一律可查、全部留下兩邊的稽核（透明而非授權）；(b) 租戶系統設定 `support.allowPlatformLookup`（[`backend/12-settings.md`](../architecture/backend/12-settings.md)），關掉時查詢略過該租戶、只顯示「租戶不允許」；
   (c) 查詢一律可、救援動作需要租戶事先授權（與 [`support-access.md`](./support-access.md) 的授權共用）。另需決定查詢字串是否存原文進平台稽核（原文才查得到「誰查過某人」，但平台稽核多一份個資）。
   傾向 (a) ＋ 查詢字串存原文：救援的情境通常正是租戶管理員失聯，要租戶事先同意會讓功能在最需要時用不了。
7. **租戶管理員要不要收到通知？** 除了稽核，可在動作後以 `NotificationService.notify` 通知該租戶的 super-admin（[`backend/15-notification.md`](../architecture/backend/15-notification.md) §9）。
   可選：(a) 不通知；(b) 只對 `resetMfa`、`issueRecoveryLink` 通知；(c) 每個動作都通知。對象本人的通知照租戶端既有行為（重設 MFA 有通知信，解鎖沒有）。傾向 (b)。
8. **停用、migration 落後的租戶**：查不到就列在 `unavailable` 即可，還是用 `Tenancy.runForMaintenance` 仍讓平台查停用租戶的使用者（例：停用前要確認誰還有帳號）？傾向這一版只查 `active`，等 [`tenant-lifecycle.md`](./tenant-lifecycle.md) 定案。
9. **查詢的速率與濫用**：平台管理者可以用部分字串把所有租戶的 email 掃出來。是否要每位管理者的查詢次數上限（沿用 `RateLimitGuard`，新增一個具名的限制）或每次結果上限之外的每日上限？傾向只做結果上限 ＋ 稽核，先不加速率限制。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

完成後預計寫成：

- [`docs/architecture/05-tenancy.md`](../architecture/05-tenancy.md) 新增一節「跨租戶查使用者與救援」（查詢的走法、效能邊界、無法查詢的租戶），設計決策放在最後新的一章；並修訂 §10.2 D11、D19 的適用範圍
- [`docs/architecture/iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8 加 `tenantUser:*`；[`iam/05-bootstrap.md`](../architecture/iam/05-bootstrap.md) §7 註明畫面上的替代做法
- [`docs/architecture/backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §3、§8.1（平台操作者在租戶稽核的表示法）；[`backend/04-auth.md`](../architecture/backend/04-auth.md) §7（撤銷 session）
- [`docs/architecture/04-sso.md`](../architecture/04-sso.md) §6.2（apps/platform 的新頁面）

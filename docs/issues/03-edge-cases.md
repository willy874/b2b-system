# 邊際操作檢查

> 掃描日期：2026-09-30 ・ 前提：企業多租戶、1000 人同時在線 ・ 範圍：`apps/api/src/modules/{auth,user,role,permission,approval,file,tenant,realtime,platform-admin,identity-provider}`、`apps/api/src/core/{cache,events,jobs,errors,database,http}`、`apps/api/src/common/{auth,guards,rate-limit.ts}`、`apps/api/src/db/migrations/*.sql`、`apps/api/src/db/seeds/roles.ts`；前端 `apps/backstage/src/core/auth/SessionStore.ts`、`plugins/fetcher/*`、`core/realtime/RealtimeCoordinator.ts`、`apis/file/upload-file/*`、`features/{user,role,audit-log}` 的部分頁面；測試 `apps/api/test/*.spec.ts`、`apps/e2e/tests/*.spec.ts`（只看案例清單）。未看：`oidc-provider` 細節、`file-image`、`file-maintenance`、`resource-grant` 解析器內部、`apps/auth` 前端。

多實例（`replicas > 1`）下快取、推播、速率限制只在本程序生效，已記載於 [`docs/features/multi-instance.md`](../features/multi-instance.md) 與 [`01-system.md`](../architecture/01-system.md) §4.3，本報告不重複列為問題；以下每項都以「單一 api 執行個體」為前提。

## 摘要

| ID | 嚴重度 | 標題 | 位置 |
| --- | --- | --- | --- |
| EDGE-01 | P0 | 鎖定到期後帳號仍永久停在 `locked`；任何人都能遠端鎖定並踢下線任一帳號（含最後一位 super-admin） | `modules/auth/auth.service.ts:110-178,395` |
| EDGE-02 | P0 | 被停用的 `pending` 使用者仍能用啟用信把自己改回 `active` | `modules/auth/auth.service.ts:458-470`、`modules/user/user.service.ts:143-153` |
| EDGE-03 | P1 | 「最後一位 super-admin」保護是 check-then-act，兩人同時操作可把 super-admin 清空 | `modules/user/user.service.ts:184-187,237-240,417-421` |
| EDGE-04 | P1 | 速率限制以 IP 計算，企業 NAT 後的 1000 人共用一個額度 | `common/rate-limit.ts:18-27`、`app.module.ts:57-61` |
| EDGE-05 | P1 | 登入失敗計數是 read-modify-write，併發的錯誤密碼只算一次，鎖定可被繞過 | `modules/auth/auth.service.ts:144-155` |
| EDGE-06 | P1 | 軟刪除使用者不清 `user_identities`：同 email 重建的帳號再也無法用該 IdP 登入 | `modules/user/user.service.ts:184-204`、`modules/auth/external-login.service.ts:238-245` |
| EDGE-07 | P1 | 佈建途中程序當掉，租戶永久卡在 `provisioning`（不能重試、不能刪除） | `modules/tenant/tenant-provisioner.ts:25-29`、`platform-tenant.service.ts:156,206` |
| EDGE-08 | P1 | 非 super-admin 可以停用、刪除、拔掉其他 super-admin 的角色（待確認設計） | `modules/user/user.service.ts:131-137,225-240` |
| EDGE-09 | P2 | 權限／使用者快取「讀 DB → 寫快取」與失效有競態，撤銷後仍可能沿用舊值到 TTL | `modules/permission/permission.service.ts:24-36`、`common/auth/access-token.verifier.ts:103,127-142` |
| EDGE-10 | P2 | refresh 回應遺失（逾時、斷線）→ 下次以舊 cookie 續期被判重用 → 整條家族撤銷並寫高嚴重度稽核 | `modules/auth/refresh-rotation.ts:74-92` |
| EDGE-11 | P2 | `PUT /users/:id/roles` 無版本控制；前端勾選草稿不隨推播更新，兩位管理者互相覆寫 | `modules/user/user.service.ts:225-257`、`features/user/pages/UserDetail/useUserRoleSelection.ts` |
| EDGE-12 | P2 | 管理者可經「改角色權限／刪除角色」把自己（與所有同角色的人）鎖在外面 | `modules/role/role.service.ts:137-191,235-268` |
| EDGE-13 | P2 | 資料夾移動沒有檢查深度上限，可繞過 `MAX_FOLDER_DEPTH` | `modules/file/file-folder.service.ts:270-307,446-471` |
| EDGE-14 | P2 | `pending` 使用者的啟用信過期或寄送失敗後沒有重寄路徑；重設密碼對 `pending` 無效 | `modules/auth/auth.service.ts:407-425`、`modules/auth/auth-mail.jobs.ts:34-41` |
| EDGE-15 | P2 | 領域事件是全程序單一序列佇列，`refreshAudience` 逐人查 DB，跨租戶互相阻塞 | `core/events/event-bus.ts:35`、`modules/realtime/realtime.audience.ts:89-96` |
| EDGE-16 | P2 | 個人資料夾命名碰撞會讓整批建立失敗（email 重用、同名使用者） | `modules/file/file-system-folder.service.ts:155-200` |
| EDGE-17 | P3 | 未對應的唯一鍵衝突回 500、Nest 內建 400 回 `INTERNAL_ERROR` 碼 | `core/errors/postgres-error.ts:33-42`、`core/errors/http-exception.filter.ts:85-95` |
| EDGE-18 | P3 | 同一權限同時在 `add` 與 `remove`：實際結果與稽核紀錄相反 | `modules/role/role.service.ts:149-180` |
| EDGE-19 | P3 | 角色刪除的 `ROLE_IN_USE` 檢查與受影響者清單都在交易外 | `modules/role/role.service.ts:239-262` |
| EDGE-20 | P3 | 並行移除網域可以把租戶的網域移光 | `modules/tenant/platform-tenant.service.ts:241-254` |
| EDGE-21 | P3 | 列表輸入邊界：`ILIKE` 萬用字元未跳脫、`offset` 無上限（待驗證）、角色名稱大小寫敏感 | `core/http/pagination.ts:3-6`、`modules/user/user.repository.ts:75-82`、`modules/role/role.repository.ts:97-100` |
| EDGE-22 | P3 | 分塊上傳 `complete` 的併發與中斷：誤報失敗、永遠無法完成、重傳產生重複檔 | `modules/file/file.service.ts:238-304`、`core/storage/s3-object-storage.ts:55-60` |
| EDGE-23 | P3 | 啟用／重設 token 的 `markUsed` 不是條件式，同一 token 併發可用兩次 | `modules/auth/auth-token.service.ts:64-79` |
| EDGE-24 | P3 | 平台的租戶操作：稽核不在狀態變更的同一交易（規則 6） | `modules/tenant/platform-tenant.service.ts:168-219` |
| EDGE-25 | P3 | 系統角色：軟刪除不受 DB trigger 保護；顯示名稱可改（待確認） | `db/migrations/0001_functions_and_triggers.sql:5-18`、`modules/role/role.service.ts:107-135` |
| EDGE-26 | P3 | 前端：離開未儲存無提示；權限被撤銷時的 UI 行為與重連後全面 revalidate 的尖峰（待驗證） | `apps/backstage/src/features/**`、`core/realtime/RealtimeCoordinator.ts` |

數量：P0 × 2、P1 × 6、P2 × 8、P3 × 10。

## 詳細

### EDGE-01 鎖定到期後帳號仍永久停在 `locked`；任何人都能遠端鎖定並踢下線任一帳號

- **嚴重度**：P0（系統無法管理：最後一位 super-admin 可被外部人員鎖死）
- **位置**：[auth.service.ts:110-118](../../apps/api/src/modules/auth/auth.service.ts#L110)、[auth.service.ts:144-178](../../apps/api/src/modules/auth/auth.service.ts#L144)、[auth.service.ts:395](../../apps/api/src/modules/auth/auth.service.ts#L395)、[external-login.service.ts:314](../../apps/api/src/modules/auth/external-login.service.ts#L314)
- **現況**：
  - `registerFailedAttempt` 第 5 次失敗時同時寫 `lockedUntil = now + 15 分` 與 `status = 'locked'`（L153）。
  - `verifyCredentials` 先判斷 `lockedUntil > now`（L110），到期後落到 `if (user.status !== 'active') throw AUTH_ACCOUNT_DISABLED`（L118）——**在驗密碼之前**。沒有任何程式把 `locked` 在到期後改回 `active`（全 repo 只有 `unlock`、`resetPassword` 會改）。
  - `forgotPassword` 只對 `status === 'active'` 寄信（L395），所以被鎖的人也無法自助重設。
  - 外部 IdP 登入同樣以 `status === 'locked'` 拒絕（external-login L314），不看 `lockedUntil`。
  - 文件（[04-auth.md §3.3](../architecture/backend/04-auth.md)）寫「等 15 分鐘自動過期（下次成功登入時 status 回到 active）」；平台管理者的實作（[platform-admin.service.ts:42-65](../../apps/api/src/modules/platform-admin/platform-admin.service.ts#L42)）確實只擋 `inactive`/`pending`、成功後改回 `active`，租戶使用者的實作與之不一致。
  - 鎖定時會發 `SESSIONS_REVOKED`（L159），而 `AccessTokenVerifier` 對非 `active` 一律回 `AUTH_ACCOUNT_DISABLED`：**線上的人會被立刻踢掉**。
  - `LAST_SUPER_ADMIN` 只防管理操作；登入失敗路徑不受它限制，最後一位 super-admin 被鎖後 I8「永遠至少有一個可用的 super-admin」即被打破。
- **重現步驟**：
  1. 在租戶網域以某位 super-admin 的 email 連續送 5 次錯誤密碼（每分鐘 10 次／IP 的限流擋不住）。
  2. 該 super-admin 開著的分頁立即收到 `session.revoked`，下一個請求 401。
  3. 等 16 分鐘後用正確密碼登入 → `AUTH_ACCOUNT_DISABLED`；按「忘記密碼」→ 不會收到信。
  4. 若租戶只有一位 super-admin 且沒有其他持 `user:update` 的人，租戶無人能解鎖。
- **預期 vs 實際**：預期 15 分鐘後自動解鎖、正確密碼可登入；實際永久鎖定直到管理員手動解鎖。
- **建議**：
  1. 鎖定只寫 `lockedUntil`，**不改 `status`**（把 `locked` 保留給管理員手動鎖定）；或在 `verifyCredentials` 中 `status === 'locked' && lockedUntil <= now` 視同 `active` 繼續驗密碼，成功時一併寫回 `status: 'active'`（與平台管理者一致）。
  2. 自動鎖定期間 **不撤銷既有 session**：鎖定的目的是擋猜密碼，不是踢掉已登入的人；否則它就是一個零成本的 DoS。
  3. `forgotPassword` 允許 `locked`（`resetPassword` 本來就會順帶解鎖）。
  4. 考慮以「帳號 × IP」累計失敗，或在最後一位 active super-admin 上改用漸進延遲而不是鎖定。
- **驗收**：整合測試——鎖定後把 `lockedUntil` 調到過去，正確密碼登入成功且 `status` 回到 `active`；鎖定期間既有 access token 仍可用；`locked` 狀態的人可收到重設信；SSO 登入在鎖定到期後可通過。

### EDGE-02 被停用的 `pending` 使用者仍能用啟用信把自己改回 `active`

- **嚴重度**：P0（權限錯誤：管理員的停用被使用者自行推翻）
- **位置**：[auth.service.ts:458-470](../../apps/api/src/modules/auth/auth.service.ts#L458)、[user.service.ts:143-153](../../apps/api/src/modules/user/user.service.ts#L143)、[auth-token.service.ts:64-73](../../apps/api/src/modules/auth/auth-token.service.ts#L64)
- **現況**：`setup()` 只檢查 activation token 可用，找到使用者後一律寫 `status: 'active'`（L467），不看目前狀態。管理員把 `pending` 的人改成 `inactive` 時（`update` 的 `deactivating` 分支），只撤銷 refresh token 與遞增 `token_version`，**沒有作廢 `auth_tokens`**。啟用 token 有效 24 小時。
- **重現步驟**：
  1. 管理員建立使用者 U（`pending`），啟用信寄出。
  2. 管理員在使用者詳情把 U 改為 `inactive`（例：誤建、已離職）。
  3. U 點開信中的連結設定密碼 → `POST /auth/setup` 成功，`status` 變 `active`，可以登入。
- **預期 vs 實際**：預期停用後啟用連結失效（或 setup 只接受 `pending`）；實際帳號被自行啟用。
- **建議**：`setup()` 只接受 `user.status === 'pending'`，其餘回 `AUTH_SETUP_TOKEN_INVALID`；並在 `UserService.update` 的停用、`remove` 時於同一交易作廢該使用者所有未使用的 `auth_tokens`。同理 `resetPassword` 對 `inactive` 的人雖不改狀態，也應作廢 token。
- **驗收**：整合測試「pending → inactive 後以原 activation token setup → 400 且狀態仍為 inactive」；「刪除使用者後 reset token 失效」。

### EDGE-03 「最後一位 super-admin」保護是 check-then-act

- **嚴重度**：P1（結果是系統無法管理，但需兩個操作同時提交）
- **位置**：[user.service.ts:184-187](../../apps/api/src/modules/user/user.service.ts#L184)、[user.service.ts:134-137](../../apps/api/src/modules/user/user.service.ts#L134)、[user.service.ts:237-240](../../apps/api/src/modules/user/user.service.ts#L237)、[user.service.ts:417-421](../../apps/api/src/modules/user/user.service.ts#L417)、[user.repository.ts:203-218](../../apps/api/src/modules/user/user.repository.ts#L203)
- **現況**：`assertNotLastSuperAdmin` 在交易外計數（排除目標本人），之後才開交易寫入；沒有列鎖、advisory lock 或 DB 約束。I8 在 [01-domain-model.md §4](../rbac/01-domain-model.md) 要求「以 DB 約束或交易保證」，實作只有應用層檢查。另外權限快取（`getPermissionSet`）判斷 `isSuper`，快取可能是舊的。
- **重現步驟**：
  1. 租戶恰有兩位 active super-admin：S1、S2。
  2. S1 送 `DELETE /users/S2`、S2 同時送 `DELETE /users/S1`（或一個停用、一個 `PUT roles` 拿掉 super-admin）。
  3. 兩邊的計數都看到「排除目標後還剩 1」，兩個交易都提交 → 沒有任何 active super-admin。
- **預期 vs 實際**：預期後到者 `LAST_SUPER_ADMIN`；實際兩者都成功。
- **建議**：在寫入交易內先 `SELECT pg_advisory_xact_lock(hashtext('super_admin_guard'))`（或 `SELECT … FROM users JOIN user_roles … FOR UPDATE` 鎖住所有 super-admin 持有者列），**在交易內**重新計數再寫入；`isSuper` 改直接查 DB 不走快取。
- **驗收**：整合測試以 `Promise.all` 同時送兩個互刪請求，斷言恰好一個 `LAST_SUPER_ADMIN`、DB 內仍有一位 active super-admin。

### EDGE-04 速率限制以 IP 計算，企業 NAT 後共用一個額度

- **嚴重度**：P1（在前提「企業、1000 人同時在線」下常態觸發）
- **狀態**：已修（fix/infra-tenancy）：同 PERF-01；rate-limit.guard.spec 驗證同一 IP 兩個使用者各自有獨立額度
- **位置**：[rate-limit.ts:18-27](../../apps/api/src/common/rate-limit.ts#L18)、[app.module.ts:57-61](../../apps/api/src/app.module.ts#L57)、[env.schema.ts:76](../../apps/api/src/core/config/env.schema.ts#L76)
- **現況**：`ThrottlerGuard` 使用預設 tracker（`req.ip`），沒有覆寫 `getTracker`。預設 `DEFAULT_RATE_LIMIT = 120/分/IP`、`/auth/login` 10/分/IP、`/auth/refresh` 30/分/IP。Access token 5 分鐘，一千人約每分鐘 200 次續期。
- **重現步驟**：
  1. 讓 50 個瀏覽器（同一個出口 IP）同時登入並停在列表頁。
  2. 一分鐘內 `/auth/refresh` 超過 30 次 → 429；`SessionStore` 視 429 為暫時錯誤、保留 session，但 access token 已過期，後續請求持續 401→續期→429。
  3. 週一早上同一辦公室 11 人同時登入即觸發登入 429。
- **預期 vs 實際**：預期企業內正常使用不受限；實際整個辦公室被當成一個客戶端。
- **建議**：已驗證身分的請求改以 `租戶 × 使用者` 為 key（`getTracker` 讀 `req.user` / JWT `sub`），未驗證的端點以 `租戶 × IP ×（email）` 為 key；額度改成可依租戶設定；部署文件註明 `TRUST_PROXY` 與 NAT 的影響。
- **驗收**：單元測試 tracker 產生的 key；整合測試同一 IP、兩個不同使用者各自有獨立額度。

### EDGE-05 登入失敗計數是 read-modify-write

- **嚴重度**：P1（暴力破解防護可被併發繞過）
- **位置**：[auth.service.ts:144-155](../../apps/api/src/modules/auth/auth.service.ts#L144)
- **現況**：`count = user.failedLoginCount + 1` 用的是請求開頭讀到的值，再 `UPDATE … SET failed_login_count = count`。N 個併發錯誤密碼請求都讀到同一個舊值，只會加 1。argon2 驗證需要數十毫秒，窗口很大。
- **重現步驟**：1. 從多個 IP 同時對同一帳號送 20 個錯誤密碼。2. 查 `users.failed_login_count` 遠小於 20，且帳號未鎖定。
- **預期 vs 實際**：預期累計 20、第 5 次起鎖定；實際只算幾次。
- **建議**：改成原子更新 `SET failed_login_count = failed_login_count + 1 … RETURNING failed_login_count`，依回傳值決定是否寫 `locked_until`（可用 `CASE WHEN failed_login_count + 1 >= $max`）；平台管理者（[platform-admin.service.ts:90-99](../../apps/api/src/modules/platform-admin/platform-admin.service.ts#L90)）同樣修。
- **驗收**：整合測試併發 10 個錯誤密碼後 `failed_login_count = 10` 且已鎖定。

### EDGE-06 軟刪除使用者不清 `user_identities`

- **嚴重度**：P1
- **位置**：[user.service.ts:184-204](../../apps/api/src/modules/user/user.service.ts#L184)、[external-login.service.ts:238-245](../../apps/api/src/modules/auth/external-login.service.ts#L238)、[0000_baseline.sql:297](../../apps/api/src/db/migrations/0000_baseline.sql)（`user_identities_provider_subject_key`）
- **現況**：`user_identities.user_id` 是 `ON DELETE CASCADE`，但使用者是 **軟刪除**，連結列留著。之後 SSO 登入：`findIdentity(provider, subject)` 找到舊連結 → `findAccountById(舊 id)` 過濾掉已刪除 → `AUTH_SSO_ACCOUNT_NOT_FOUND`；因為 `(provider_id, subject)` 唯一，也無法再連結到新帳號。email 可重用是設計目標（I4），兩者互相矛盾。
- **重現步驟**：1. 使用者 A 以外部 IdP 登入過（已連結）。2. 管理員刪除 A，再以同 email 建立 A'（或 `auto_create` 自動建立）。3. A' 以同一 IdP 登入 → 永遠 `AUTH_SSO_ACCOUNT_NOT_FOUND`。
- **預期 vs 實際**：預期 A' 可登入（依 email 重新連結）；實際永遠被拒。
- **建議**：刪除使用者的交易內一併刪除其 `user_identities`（稽核保留紀錄）；或 `resolveAccount` 發現連結指向已刪除帳號時刪掉舊連結、落回 email 比對。
- **驗收**：`sso-external.spec.ts` 加「刪除後重建同 email → SSO 登入成功並連結到新帳號」。

### EDGE-07 佈建途中程序當掉，租戶永久卡在 `provisioning`

- **嚴重度**：P1（該租戶無法再由平台管理）
- **狀態**：已修（fix/infra-tenancy）：新排程 tenant.provisionSweep（每 5 分鐘）把逾時仍在 provisioning 的租戶改成 failed，重試與刪除前也先檢查
- **位置**：[tenant-provisioner.ts:25-29](../../apps/api/src/modules/tenant/tenant-provisioner.ts#L25)、[tenant-provisioner.ts:73-96](../../apps/api/src/modules/tenant/tenant-provisioner.ts#L73)、[platform-tenant.service.ts:156](../../apps/api/src/modules/tenant/platform-tenant.service.ts#L156)、[platform-tenant.service.ts:206](../../apps/api/src/modules/tenant/platform-tenant.service.ts#L206)
- **現況**：`tenant.provision` 設 `retryLimit: 0`；只有 handler 內 `catch` 會把狀態改成 `failed`。程序在 `ensureTenantDatabase`/migration 途中被 kill、OOM、部署重啟時，pg-boss 在 `expireInSeconds` 後把工作標成失敗，但 **租戶狀態仍是 `provisioning`**。`retryProvisioning` 只接受 `failed`、`remove` 拒絕 `provisioning`，全 repo 沒有清掃卡住狀態的機制。從管理頁手動重試工作（`job:retry`）可以救，但需要人知道。
- **重現步驟**：1. 建立租戶。2. 佈建工作執行中（例：在 migration 時）`kill -9` api。3. 重啟後租戶頁面永遠顯示「佈建中」，重試與刪除按鈕都回 `TENANT_STATUS_CONFLICT`。
- **預期 vs 實際**：預期逾時後變 `failed` 可重試；實際卡住。
- **建議**：啟動時（或排程）把 `status = 'provisioning' AND updated_at < now() - expireIn` 的租戶改為 `failed`（`provisionError: 'interrupted'`）；或讓 `retryProvisioning` 也接受「超過逾時的 provisioning」。
- **驗收**：單元測試 sweeper；整合測試模擬中斷後可重試並成功。

### EDGE-08 非 super-admin 可以停用、刪除、拔掉其他 super-admin 的角色

- **嚴重度**：P1（待確認設計；若非預期即為權限錯誤）
- **位置**：[user.service.ts:131-137](../../apps/api/src/modules/user/user.service.ts#L131)、[user.service.ts:184-187](../../apps/api/src/modules/user/user.service.ts#L184)、[user.service.ts:225-240](../../apps/api/src/modules/user/user.service.ts#L225)、[seeds/roles.ts:20-45](../../apps/api/src/db/seeds/roles.ts#L20)
- **現況**：反提權只檢查「新授予的」角色（`assertRolesAssignable(actor, dto.roleIds)`），不檢查「被操作的對象」是否比 actor 權限更高。持有 `user:update`/`user:delete`/`user:assignRole` 的 `admin`（系統角色）可以：停用或刪除任何 super-admin（只要不是最後一位）、以 `PUT /users/:id/roles` 把 super-admin 換成 member。[05-rbac.md §4.1](../architecture/backend/05-rbac.md) 只規定「只有 super-admin 能指派 super-admin」，沒有規定反方向。
- **重現步驟**：1. 以 admin 登入。2. `PUT /users/{S2}/roles {"roleIds":[memberId]}` → 200，S2 失去 super-admin。3. 重複到只剩一位 super-admin，再配合 EDGE-01 鎖定最後一位。
- **預期 vs 實際**：一般預期「不能管理權限比自己高的人」；實際可以。
- **建議**：新增規則「目標持有 super-admin 時，只有 super-admin 能改其狀態、角色、刪除、重設密碼、解鎖」（`AUTHZ_ESCALATION` 帶 `role: 'super-admin'`），寫進 05-rbac §4.1 與權限目錄文件。
- **驗收**：`rbac-lifecycle.spec.ts` 加「admin 停用／刪除／降級 super-admin → 403」。

### EDGE-09 權限／使用者快取的「讀後寫」競態

- **嚴重度**：P2（撤銷權限後，最多 60 秒內仍可能被放行）
- **位置**：[permission.service.ts:24-36](../../apps/api/src/modules/permission/permission.service.ts#L24)、[access-token.verifier.ts:103](../../apps/api/src/common/auth/access-token.verifier.ts#L103)、[access-token.verifier.ts:127-142](../../apps/api/src/common/auth/access-token.verifier.ts#L127)、[role.service.ts:182-185](../../apps/api/src/modules/role/role.service.ts#L182)
- **現況**：cache miss 時先查 DB、await 後才 `cache.set`。若查詢在「撤銷交易提交」之前讀到舊資料、而 `set` 發生在 `invalidate` 之後，舊值會被寫回並存活 `PERMISSION_CACHE_TTL`（60 秒）；使用者快取同理（30 秒，停用的人仍可通過 HTTP 驗證）。1000 人在線時，被撤銷者恰有請求在途的機率不低。現有測試「移除角色權限後下一次請求即被拒絕」是循序的，沒有覆蓋在途請求。另外 `role.remove` 的受影響者清單在交易前查出（L245），在查與刪之間被指派的人不會被失效。
- **重現步驟**：1. 使用者 U 持續高頻打需要 `user:read` 的 API。2. 管理員移除其角色的 `user:read`。3. 偶發：之後 60 秒內 U 的請求仍 200。
- **預期 vs 實際**：預期撤銷後立即生效；實際偶發延遲到 TTL。
- **建議**：快取加世代號（每個 key 一個 `version`，`invalidate` 時遞增；`get→load→set` 時若版本已變就不寫入）；或 `invalidate` 寫入「墓碑」到期前拒絕 `set`。`role.remove` 在交易內以 `DELETE … RETURNING user_id` 取得受影響者。
- **驗收**：單元測試模擬「load 期間 invalidate」後快取為空；壓力測試撤銷後 1 秒內無 200。

### EDGE-10 refresh 回應遺失 → 被判重用並撤銷整條家族

- **嚴重度**：P2
- **位置**：[refresh-rotation.ts:74-92](../../apps/api/src/modules/auth/refresh-rotation.ts#L74)、[auth.service.ts:232-245](../../apps/api/src/modules/auth/auth.service.ts#L232)、[SessionStore.ts:193-222](../../apps/backstage/src/core/auth/SessionStore.ts#L193)、[http-context.ts:60](../../apps/backstage/src/plugins/app/http-context.ts#L60)
- **現況**：伺服器輪替成功、但回應在抵達瀏覽器前遺失（前端 `REQUEST_TIMEOUT_MS` 到期中止、行動網路切換、代理逾時）時，瀏覽器沒有收到新的 `Set-Cookie`，下次續期用舊 token → `usedAt` 非空 → `AUTH_REFRESH_REUSED`、撤銷整條家族、寫 `severity: 'high'` 稽核。多分頁由 Web Locks 協調得很好（見「已處理得好」），但這個情境與多分頁無關；沒有寬限期。瀏覽器不支援 `navigator.locks` 時退回分頁內單飛（L56-58），多分頁會直接觸發同樣結果。
- **重現步驟**：1. 在 DevTools 把 `/api/auth/refresh` 回應延遲到超過前端逾時。2. 下一次續期 → 被登出，稽核出現 `auth.refresh.reuse_detected`。
- **預期 vs 實際**：預期網路抖動不導致登出與假警報；實際兩者都發生。
- **建議**：加入短寬限期（例：同一張 token 在 `usedAt` 後 10–30 秒內再出示、且家族最新一張尚未被用過 → 回傳那張的替代品或要求重登但不撤銷家族、不記 high）；或把寬限期內的重用降為 `warning`。refresh 請求不套用一般逾時（或放長）。
- **驗收**：`refresh-rotation.spec.ts` 加「輪替後 5 秒內以舊 token 再續期 → 不撤銷家族」；「超過寬限期 → 仍判重用」。

### EDGE-11 `PUT /users/:id/roles` 無版本控制，前端草稿不隨推播更新

- **嚴重度**：P2（lost update；權限被默默改回）
- **位置**：[user.service.ts:225-257](../../apps/api/src/modules/user/user.service.ts#L225)、[user.repository.ts:167-179](../../apps/api/src/modules/user/user.repository.ts#L167)、[useUserRoleSelection.ts](../../apps/backstage/src/features/user/pages/UserDetail/useUserRoleSelection.ts)
- **現況**：整批取代語意、沒有 `version`/`If-Match`；`before` 在交易外讀取，稽核的 before 可能是舊的。前端 `useUserRoleSelection` 一旦勾選過就保留自己的草稿，伺服器推播更新 `user.roles` 後草稿不變，按「指派」會把別人剛做的變更覆寫掉。`PATCH /users/:id`、`PATCH /roles/:id` 同樣沒有版本（檔案 `update` 有 `FILE_VERSION_CONFLICT`，做法已存在）。角色權限用差異語意（`add`/`remove`）避開了這個問題，值得肯定。
- **重現步驟**：1. 管理員 A、B 同時打開使用者 U 詳情。2. A 勾選 auditor 但未送出。3. B 把 U 的角色改成 admin 並送出（A 的頁面收到推播）。4. A 送出 → U 只剩 A 草稿中的角色，B 的變更消失。
- **預期 vs 實際**：預期 A 收到衝突提示；實際靜默覆寫。
- **建議**：`users`/`roles` 加 `version` 欄（或以 `updated_at` 作 ETag），PUT/PATCH 帶 `version`，不符回 `409 *_VERSION_CONFLICT`；前端在草稿存在且伺服器值改變時提示「資料已被他人修改」。
- **驗收**：整合測試兩個以同一 version 的 PUT，第二個 409；前端 hook 測試推播後出現衝突提示。

### EDGE-12 管理者可把自己鎖在外面

- **嚴重度**：P2
- **位置**：[role.service.ts:137-191](../../apps/api/src/modules/role/role.service.ts#L137)、[role.service.ts:235-268](../../apps/api/src/modules/role/role.service.ts#L235)、[01-system.md §6「自我保護」](../architecture/01-system.md)
- **現況**：自我保護只在 `UserService`（不能改自己的狀態、角色、刪除自己）。但 `updatePermissions` 可以移除 actor 自己所持角色的權限（`remove` 不做任何檢查，只有 super-admin 角色不可變），`remove(force=true)` 可以刪掉 actor 自己持有的角色。`admin` 是系統角色但權限可改。文件寫「不能移除自己最後一個具 `role:update` 的角色」，實作未涵蓋這條路徑。
- **重現步驟**：1. admin 開啟 `admin` 角色的權限頁。2. 移除 `role:grantPermission`、`role:update` → 200。3. 所有 admin（含自己）再也無法改回，只能等 super-admin。
- **預期 vs 實際**：預期拒絕或至少二次確認；實際直接生效。
- **建議**：`updatePermissions`/`remove` 若 actor 持有該角色、且變更會讓 actor 失去 `role:update` 或 `role:grantPermission`，回 `AUTHZ_SELF_MODIFY`（super-admin 豁免）；前端顯示警告。
- **驗收**：整合測試「admin 移除自己角色的 role:grantPermission → 403」、「force 刪除自己持有的角色 → 403」。
- **狀態**：已修（fix/role-events）——改用新錯誤碼 `ROLE_SELF_LOCKOUT`（403，`details.lost`）而非 `AUTHZ_SELF_MODIFY`，訊息較明確；受保護的權限為 `role:read`、`role:update`、`role:grantPermission`，super-admin 豁免（docs/architecture/backend/05-rbac.md §8.4）。前端只補錯誤訊息翻譯，沒有另做事前警告。

### EDGE-13 資料夾移動沒有檢查深度上限

- **嚴重度**：P2
- **位置**：[file-folder.service.ts:270-307](../../apps/api/src/modules/file/file-folder.service.ts#L270)、[file-folder.service.ts:436-471](../../apps/api/src/modules/file/file-folder.service.ts#L436)、[file.constants.ts:97](../../apps/api/src/modules/file/file.constants.ts#L97)
- **現況**：`create`、`ensurePaths` 都呼叫 `assertDepth`；`move` 只做循環與同名檢查（`assertMovable`），沒有計算「目的地深度 + 被移動子樹高度」。遞迴 CTE（`findAncestorIds`、`findDescendantIds`）與前端樹狀渲染都假設深度 ≤ 32。
- **重現步驟**：1. 建兩條各 30 層的資料夾鏈 A、B。2. 把 B 的根移到 A 的最底層 → 200，深度 60。3. 之後在最底層 `create` 回 `VALIDATION_FAILED`（depth），但既有結構已超限。
- **預期 vs 實際**：預期移動被拒；實際成功。
- **建議**：`assertMovable` 內計算每個 `moving` 的子樹高度（遞迴 CTE 取 max depth），`ancestors.length + height > MAX_FOLDER_DEPTH` 時拒絕。
- **驗收**：`file-folder.service.spec.ts` 加「移動後超過深度 → VALIDATION_FAILED(depth)」。
- **狀態**：已修（fix/file）：移動時以遞迴 CTE 取被移動子樹的最大高度，目的地深度 ＋ 高度超過 32 回 `VALIDATION_FAILED(depth)`

### EDGE-14 `pending` 使用者的啟用信過期或寄送失敗後沒有重寄路徑

- **嚴重度**：P2
- **位置**：[auth.service.ts:407-425](../../apps/api/src/modules/auth/auth.service.ts#L407)、[auth-mail.jobs.ts:34-48](../../apps/api/src/modules/auth/auth-mail.jobs.ts#L34)、[user.service.ts:107-129](../../apps/api/src/modules/user/user.service.ts#L107)、[update-user.dto.ts](../../apps/api/src/modules/user/dto/update-user.dto.ts)
- **現況**：啟用信只在建立時入列一次（`ACTIVATION_MAIL_JOB` 只有 `create` 與佈建使用）。token 24 小時過期、或 SMTP 5 次重試都失敗後，沒有「重寄啟用信」端點。管理員的「重設密碼」會寄重設信，但 `resetPassword` 對 `pending` 不改狀態（L420），設好密碼仍 `AUTH_ACCOUNT_PENDING`。另外 `UpdateUserSchema.status` 允許把 `active` 的人改成 `pending`，之後既無啟用 token 也無法登入。
- **重現步驟**：1. 建立使用者，25 小時後才點啟用連結 → `AUTH_SETUP_TOKEN_INVALID`。2. 管理員按「重設密碼」→ 使用者設定密碼 → 登入 `AUTH_ACCOUNT_PENDING`。
- **預期 vs 實際**：預期可重寄啟用信；實際只能刪除重建或手動改 `active` 再走忘記密碼。
- **建議**：新增 `POST /users/:id/resend-activation`（只接受 `pending`），或讓 `resetPassword` 對 `pending` 的人改寄啟用信；`UpdateUserSchema.status` 移除 `pending`。
- **驗收**：整合測試重寄後舊 token 失效、新 token 可用；PATCH `status: 'pending'` → 400。

### EDGE-15 領域事件是全程序單一序列佇列

- **嚴重度**：P2（1000 人在線時推播延遲、跨租戶互相影響）
- **位置**：[event-bus.ts:25-39](../../apps/api/src/core/events/event-bus.ts#L25)、[realtime.audience.ts:89-96](../../apps/api/src/modules/realtime/realtime.audience.ts#L89)、[file-system-folder.service.ts:155-200](../../apps/api/src/modules/file/file-system-folder.service.ts#L155)
- **現況**：`DomainEventBus` 以一條 `this.queue` 串起所有租戶的所有事件，每個 handler await 完才處理下一個。`refreshAudience` 對每位在線使用者依序 `await roomsFor(id)`（每人至少兩個 DB 查詢）；`ensurePersonalFolders` 會取整棵資料夾樹的 advisory lock。改一個被 1000 位在線使用者持有的角色（例：member）→ 2000+ 次循序查詢，期間 **所有租戶** 的推播、`SESSIONS_REVOKED`（踢線）都排在後面。事件只在記憶體，程序在提交後、分派前當掉會遺失（個人資料夾有開機補做，推播則由前端重連 resync 補齊，影響有限）。
- **重現步驟**：1. 租戶 A 的 member 角色有 1000 位在線使用者。2. 修改 member 的權限。3. 同時在租戶 B 停用一位使用者 → B 的踢線推播延遲到 A 的 refreshAudience 跑完。
- **預期 vs 實際**：預期租戶間互不影響、踢線即時；實際排隊。
- **建議**：佇列以租戶分開（`Map<tenantId, Promise>`），`SESSIONS_REVOKED` 走優先通道；`refreshAudience` 批次查權限（一次查所有 userId）並以有限並行處理。
- **驗收**：單元測試兩個租戶的事件可並行；壓測 1000 人的角色變更在 N 秒內完成且不阻塞其他租戶。
- **狀態**：已修（fix/role-events）——同 PERF-08：佇列依租戶分開（`Map<lane, Promise>`，處理完即移除）、`SESSIONS_REVOKED` 每個租戶另有優先通道、權限批次查詢；單元測試驗證兩個租戶的事件可並行、踢線不排在同租戶卡住的事件之後。事件只在記憶體（程序當掉會遺失）維持現狀，影響如現況所述有限。

### EDGE-16 個人資料夾命名碰撞會讓整批建立失敗

- **嚴重度**：P2
- **位置**：[file-system-folder.service.ts:155-200](../../apps/api/src/modules/file/file-system-folder.service.ts#L155)、[file-folder.service.ts:404-415](../../apps/api/src/modules/file/file-folder.service.ts#L404)（同樣的 `writeTree` 模式）、[0000_baseline.sql:283](../../apps/api/src/db/migrations/0000_baseline.sql)
- **現況**：名稱規則是 `displayName`，同名則 `displayName (email)`，不再有第三順位。刪除使用者時「有內容的個人資料夾保留」。同一 email 被刪除重建兩次（每次都留有檔案），第三次時兩個候選名稱都被佔用 → `file_folders_parent_name_key` 衝突 → 整個交易 rollback：**同一批所有缺少個人資料夾的人都建不成**；在事件 handler 內錯誤被吞掉，開機時的 `prepareTenant` 也每次失敗。另外 `displayName` 允許 `/`、控制字元以外的任意字元與 100 字，未經 `FileFolderNameSchema` 驗證（`/`、`..` 可能成為資料夾名稱）。
- **重現步驟**：1. 建立 Alice（有 file 權限）→ 上傳一個檔到個人資料夾 → 刪除 Alice。2. 以同 email、同名重建 → 上傳 → 再刪除。3. 第三次重建 → 個人資料夾不會出現，日誌出現「領域事件處理失敗」。
- **預期 vs 實際**：預期總能得到一個不衝突的名稱、且單人失敗不影響其他人；實際整批失敗。
- **建議**：命名改為遞增後綴直到不衝突（或以 user id 前綴），名稱經 `FileFolderNameSchema` 清理；每人一個 savepoint 或逐人交易，單人失敗只記錄。
- **驗收**：單元測試連續三次同名建立都成功；一人衝突時其他人仍建立。
- **狀態**：已修（fix/file）：候選名稱依序加 email、編號、最後退回 user id，顯示名稱先清掉 `/`、`\`、控制字元；每人一個 savepoint，一人失敗只記錄

### EDGE-17 未對應的唯一鍵衝突回 500、Nest 內建 400 回 `INTERNAL_ERROR` 碼

- **嚴重度**：P3
- **位置**：[postgres-error.ts:33-42](../../apps/api/src/core/errors/postgres-error.ts#L33)、[http-exception.filter.ts:66-95](../../apps/api/src/core/errors/http-exception.filter.ts#L66)、[update-user.dto.ts:22](../../apps/api/src/modules/user/dto/update-user.dto.ts#L22)、[user.repository.ts:167-179](../../apps/api/src/modules/user/user.repository.ts#L167)
- **現況**：`CONSTRAINT_TO_CODE` 只有 users/roles 四個；其他唯一鍵（`user_roles_pkey`、`resource_grants_resource_subject_key`、`identity_providers_name_key` 等）衝突時 `mapConstraintToCode` 回 `'INTERNAL_ERROR'` → `statusOf` = 500。`ReplaceUserRolesSchema` 沒有去重，`replaceRoles` 的 INSERT 沒有 `onConflictDoNothing`：`{"roleIds":[a,a]}` → 500（`assertRolesExist` 以 `Set` 比數量會放行）。`ParseUUIDPipe` 等 Nest 內建例外走 `HttpException` 分支，非 429 一律 `code: 'INTERNAL_ERROR'`，前端顯示「系統錯誤」。
- **重現步驟**：1. `PUT /users/{id}/roles {"roleIds":["<同一個>","<同一個>"]}` → 500。2. `GET /users/not-a-uuid` → 400、`code: INTERNAL_ERROR`。
- **預期 vs 實際**：預期 400 `VALIDATION_FAILED`；實際 500／錯誤碼誤導。
- **建議**：陣列 DTO 一律 `.refine(unique)` 或在 service 去重；未對應的 23505 回 409 `CONFLICT` 而非 500；`HttpException` 依狀態碼對應（400 → `VALIDATION_FAILED`、404 → `NOT_FOUND`）。
- **驗收**：`rbac-lifecycle.spec.ts` 加重複 roleIds 與非法 UUID 的案例。
- **狀態**：已修（fix/role-events）——未對應的 23505 回 409 `CONFLICT`（並記 warn）；`HttpException` 依狀態碼對應（400 `VALIDATION_FAILED`、401 `AUTH_TOKEN_INVALID`、403 `AUTHZ_FORBIDDEN`、404 `NOT_FOUND`、409 `CONFLICT`、429；其餘 4xx `VALIDATION_FAILED`）；`roleIds`（建立使用者、替換角色、審批核准）以 `uniqueItems()` 禁止重複，repository 的插入也去重並 `onConflictDoNothing`。

### EDGE-18 同一權限同時在 `add` 與 `remove`：結果與稽核相反

- **嚴重度**：P3
- **位置**：[role.service.ts:149-180](../../apps/api/src/modules/role/role.service.ts#L149)、[update-role.dto.ts](../../apps/api/src/modules/role/dto/update-role.dto.ts)
- **現況**：交易內先 `remove` 再 `add`，所以該權限最後 **存在**；但稽核的 `after` 以 `filter(!remove.includes)` 計算，記成 **不存在**。`before` 也在交易外讀取。
- **重現步驟**：`PATCH /roles/{id}/permissions {"add":["user:read"],"remove":["user:read"]}` → 角色持有 `user:read`，稽核 after 沒有。
- **預期 vs 實際**：預期 400 或兩者一致；實際不一致。
- **建議**：DTO `.refine` 禁止交集；或 `after` 在交易內以 `listPermissionKeys(tx)` 重新查出。
- **驗收**：DTO 單元測試交集 → 400。
- **狀態**：已修（fix/role-events）——DTO 禁止 `add`／`remove` 交集（400）；稽核的 `before`／`after` 在交易內（鎖住角色列後）讀取。

### EDGE-19 角色刪除的檢查在交易外

- **嚴重度**：P3
- **位置**：[role.service.ts:239-262](../../apps/api/src/modules/role/role.service.ts#L239)、[role.repository.ts:149-155](../../apps/api/src/modules/role/role.repository.ts#L149)、[user.service.ts:233-243](../../apps/api/src/modules/user/user.service.ts#L233)
- **現況**：`countUsers` 為 0 → 不需 `force`；在它與交易之間有人把角色指派出去，刪除仍會連帶刪掉那筆指派，且那人不在 `affected` 裡（快取未失效、未推播）。反向：`replaceRoles` 的 `assertRolesExist` 也在交易外，刪除後才插入的 `user_roles` 會指向已刪除角色（權限查詢有過濾 `deleted_at`，不會提權，只是殘留列）。
- **重現步驟**：同時送 `DELETE /roles/{R}`（無 force）與 `PUT /users/{U}/roles {"roleIds":[R]}`。
- **預期 vs 實際**：預期其中一個以 `ROLE_IN_USE`／`ROLE_NOT_FOUND` 失敗；實際兩者都成功、狀態不一致。
- **建議**：刪除交易內 `SELECT … FROM roles WHERE id=$1 FOR UPDATE` 後重新計數，並以 `DELETE … RETURNING user_id` 取得受影響者；指派交易內以 `FOR SHARE` 鎖住角色列再插入。
- **驗收**：整合測試併發刪除與指派。
- **狀態**：已修（fix/role-events）——刪除：交易內 `FOR UPDATE` 鎖角色列後重新計數，受影響者以 `DELETE … RETURNING` 取得；指派：`user.repository` 在交易內以 `FOR SHARE` 鎖角色列、只插入未刪除的角色。整合測試以測試端持有列鎖重現兩種先後順序。`user.service` 的 `assertRolesExist` 仍在交易外（認證帳號組負責的檔案），但交易內的 `FOR SHARE` 已保證不留下指向已刪除角色的指派。

### EDGE-20 並行移除網域可把網域移光

- **嚴重度**：P3（平台管理者操作、機率低，但結果是租戶完全無法進入）
- **狀態**：已修（fix/infra-tenancy）：網域增刪先 FOR UPDATE 鎖住租戶列再數網域；platform-tenant.spec 加併發移除案例
- **位置**：[platform-tenant.service.ts:241-254](../../apps/api/src/modules/tenant/platform-tenant.service.ts#L241)、[platform-tenant.repository.ts:122-128](../../apps/api/src/modules/tenant/platform-tenant.repository.ts#L122)
- **現況**：`domains.length <= 1` 以交易前讀到的清單判斷；兩個請求各移除一個（共兩個網域）都會通過。移除網域時，正在那個網域上的使用者（host-only cookie）會失去 session，沒有提示。
- **重現步驟**：租戶有 d1、d2；同時 `DELETE …/domains/d1` 與 `…/d2` → 兩者 200，租戶沒有網域。
- **預期 vs 實際**：預期後到者 `TENANT_LAST_DOMAIN`；實際網域清空。
- **建議**：交易內 `SELECT … FROM tenants WHERE id FOR UPDATE` 後再數網域，或以 `DELETE … WHERE (SELECT count(*) …) > 1`。
- **驗收**：`platform-tenant.spec.ts` 加併發移除案例。

### EDGE-21 列表輸入邊界

- **嚴重度**：P3
- **位置**：[pagination.ts:3-6](../../apps/api/src/core/http/pagination.ts#L3)、[user.repository.ts:75-82](../../apps/api/src/modules/user/user.repository.ts#L75)、[role.repository.ts:97-100](../../apps/api/src/modules/role/role.repository.ts#L97)、[user.service.ts:429-439](../../apps/api/src/modules/user/user.service.ts#L429)、[0000_baseline.sql:311](../../apps/api/src/db/migrations/0000_baseline.sql)
- **現況**：
  - `keyword` 直接包成 `%${keyword}%` 給 `ILIKE`，`%`、`_`、`\` 未跳脫：搜尋 `_` 會匹配所有列。`assertUsernameAvailable` 用同一個模糊搜尋、`limit: 1`，找到的第一筆可能是 `bobby` 而非 `bob`，檢查形同虛設（最後由唯一索引兜底並轉成 `USER_USERNAME_DUPLICATE`，所以不會出錯，只是多一次無用查詢）。
  - `offset` 只有 `min(0)` 沒有上限：`offset=1e19` 可能讓 postgres-js 送出非法 bigint 而 500（**待驗證**）；極大 offset 在稽核表（上限 100 筆但 offset 無上限）會造成長時間掃描。
  - `roles.name` 是 `text`（`users.email` 才是 `citext`），`Admin` 與 `admin` 可並存；Unicode 未正規化（NFC/NFD 的「é」視為不同名稱，資料夾同名檢查同樣）。
  - 已正確處理：全空白（`trim().min(1)`）、長度上限、排序欄位白名單、非法 enum、`from > to` 與 90 天範圍、非法日期（`z.coerce.date` 產生 Invalid Date 會被拒絕）。
- **建議**：共用 `escapeLike()`；`offset` 設上限（例：10 000，超過要求改用游標）；角色名稱改 `citext` 或以 `lower(name)` 建唯一索引；名稱統一 `normalize('NFC')`。`assertUsernameAvailable` 改精確查詢。
- **驗收**：`list-sort.spec.ts` 加 `keyword=_`、`offset=99999999999` 案例。
- **狀態**：已修（fix/role-events）——`core/database` 的 `escapeLike`／`containsPattern`／`prefixPattern`（角色、使用者、審批改用；檔案、稽核、平台稽核、資源授權已有各自的私有 `escapeLike`，未合併以免與其他組衝突）；`PaginationSchema` 的 offset 上限 10 000（`OffsetSchema` 也套到背景工作列表；稽核與平台稽核列表的 DTO 有自己的 offset，留給基礎設施組的 PERF-09 一併處理）；`roles_name_key` 改 `lower(name)`（migration 0006：既有名稱先 NFC 正規化，只差大小寫的保留最早建立的、其餘改名「<原名> (<slug>)」），API 端角色名稱 `normalize('NFC')`。延後：`assertUsernameAvailable` 改精確查詢（在 `user.service`，屬認證帳號組；唯一索引兜底，行為正確）；資料夾名稱的 NFC 正規化（檔案組）。

### EDGE-22 分塊上傳 `complete` 的併發與中斷

- **嚴重度**：P3
- **位置**：[file.service.ts:238-304](../../apps/api/src/modules/file/file.service.ts#L238)、[s3-object-storage.ts:55-60](../../apps/api/src/core/storage/s3-object-storage.ts#L55)、[s3-object-storage.ts:348-374](../../apps/api/src/core/storage/s3-object-storage.ts#L348)、[upload-file/fetcher.ts:47-101](../../apps/backstage/src/apis/file/upload-file/fetcher.ts#L47)
- **現況**：
  - 兩個 `complete` 同時進來（重送）：第一個完成 S3 的 CompleteMultipartUpload，第二個拿到 `NoSuchUpload` → 被對應成 `FILE_UPLOAD_INCOMPLETE`，而檔案其實已完成。
  - S3 完成後、`markReady` 前程序當掉：紀錄仍是 `pending` 且 `uploadId` 已失效，之後每次 `complete` 都是 `FILE_UPLOAD_INCOMPLETE`，只能放棄重傳。
  - 大小不符時刪掉物件並提示「可用同一網址重傳」，但分塊上傳在 CompleteMultipartUpload 後 `uploadId` 已失效，重傳不可能。
  - 前端：`complete` 已在伺服器成功但回應遺失時，走 `catch` → `abortUpload` 回 `FILE_ALREADY_UPLOADED`（被忽略）→ UI 顯示失敗，使用者重傳會產生同名重複檔（檔案允許同名）。
- **建議**：`NoSuchUpload` 時先 `head()` 物件，存在且大小相符就繼續 `markReady`；前端在 `complete` 失敗後先 `GET /files/:id` 確認狀態再決定要不要 abort。
- **驗收**：`file.service.spec.ts` 加「S3 已完成、紀錄仍 pending → complete 成功」。
- **狀態**：已修（fix/file）：`CompleteMultipartUpload` 回「塊不對」時先 HeadObject，已組好且大小相符就照常完成；前端 `complete` 失敗時先 `GET /files/:id`，已 ready 就當成功；修正分塊上傳「可用同一網址重傳」的錯誤說明

### EDGE-23 啟用／重設 token 的 `markUsed` 不是條件式

- **嚴重度**：P3
- **位置**：[auth-token.service.ts:64-79](../../apps/api/src/modules/auth/auth-token.service.ts#L64)、[auth.service.ts:407-440](../../apps/api/src/modules/auth/auth.service.ts#L407)
- **現況**：`findUsable` 在交易外檢查 `usedAt`，`markUsed` 無條件 `UPDATE`。同一個重設連結被雙擊或兩個分頁同時送出，兩次都成功（後者的密碼生效），稽核兩筆。refresh token 有正確的條件式 `markUsed`，這裡沒有沿用。
- **建議**：`markUsed` 加 `WHERE used_at IS NULL AND expires_at > now()` 並回傳是否成功，失敗時 rollback 回 `AUTH_SETUP_TOKEN_INVALID`。
- **驗收**：整合測試併發兩次 reset，恰一次成功。

### EDGE-24 平台的租戶操作：稽核不在同一交易

- **嚴重度**：P3
- **狀態**：已修（fix/infra-tenancy）：狀態／網域變更與平台稽核同一個交易，收尾失敗另記稽核
- **位置**：[platform-tenant.service.ts:168-219](../../apps/api/src/modules/tenant/platform-tenant.service.ts#L168)
- **現況**：`disable`、`enable`、`remove`、網域增刪都是「狀態變更 → 收尾 → `audit.record`」分開執行，違反 CLAUDE.md 規則 6「稽核寫入在交易內」。`endEverything` 的每一步錯誤只記 log；`remove` 在第二次 `transition` 前失敗會留下「已停用、未刪除、session 已撤銷」的中間狀態（可重做，影響小）。
- **建議**：狀態變更與平台稽核包成同一個平台 DB 交易；收尾步驟的失敗寫進稽核 metadata。
- **驗收**：單元測試稽核寫入失敗時狀態 rollback。

### EDGE-25 系統角色：軟刪除不受 DB trigger 保護；顯示名稱可改

- **嚴重度**：P3（待確認）
- **位置**：[0001_functions_and_triggers.sql:5-18](../../apps/api/src/db/migrations/0001_functions_and_triggers.sql#L5)、[role.repository.ts:149-155](../../apps/api/src/modules/role/role.repository.ts#L149)、[role.service.ts:107-135](../../apps/api/src/modules/role/role.service.ts#L107)
- **現況**：刪除角色實作是 `UPDATE roles SET deleted_at`（軟刪除），trigger 只擋 `DELETE` 與 slug／`is_system` 變更，所以 I7 的「DB trigger 雙保險」對實際的刪除路徑無效，只剩 service 檢查。`update()` 不檢查 `isSystem`，系統角色的 `name`／`description` 可改；[01-domain-model.md §1](../rbac/01-domain-model.md) 寫「`is_system` 角色不可刪除／改名」，§3.2 又說 name 可改，文件本身不一致。
- **建議**：trigger 加 `IF OLD.is_system AND NEW.deleted_at IS NOT NULL THEN RAISE`；釐清「改名」的定義並補測試。
- **驗收**：`triggers.spec.ts` 加「軟刪除系統角色被擋」。
- **狀態**：已修（fix/role-events）——migration 0006 的 `protect_system_roles` 也擋 `deleted_at` 由 NULL 變非 NULL；service 層原本就擋。系統角色的顯示名稱維持可改（既定決定），`01-domain-model.md` §1 已改為「不可刪除、不可改 slug」。註記：同文件 §5 表格寫 super-admin 的 name／description 不可改，但 `RoleService.update` 沒有擋，依既定決定未動程式，文件與實作的差異待產品確認。

### EDGE-26 前端：離開未儲存、權限撤銷時的 UI、重連尖峰

- **嚴重度**：P3（部分待驗證）
- **位置**：`apps/backstage/src/features/**`（`grep useBlocker|beforeunload` 無結果）、[RealtimeCoordinator.ts:76-92](../../apps/backstage/src/core/realtime/RealtimeCoordinator.ts#L76)、[realtime.ts:64](../../apps/backstage/src/plugins/app/realtime.ts#L64)
- **現況**：
  - 使用者／角色編輯表單沒有「離開未儲存」提示（`useBlocker`、`beforeunload` 都沒有使用）。
  - 權限在使用中被撤銷：後端下一次請求即 403（已有測試），但 E2E 沒有「頁面開著時權限被拿掉 → 選單與按鈕即時隱藏／導到 403」的案例（**待驗證**）。
  - 重連或 leader 交接時對每個分頁 `revalidateAll`；伺服器重啟時 1000 人同時重連，套用延遲只有 150–750 ms 的 jitter（**待驗證** 實際負載）。
  - 使用者偏好的 `timezone` 後端只驗 `max(64)`，未驗證是否為合法 IANA 名稱（前端時間格式化會 `RangeError`，**待驗證** 是否有使用後端值）。
- **建議**：編輯頁加 `useBlocker`；補權限撤銷的 E2E；resync 的 jitter 依在線人數放大或分批；`timezone` 以 `Intl.supportedValuesOf('timeZone')` 驗證。
- **驗收**：E2E「管理員移除權限 → 對方開著的頁面在推播後隱藏該選單」。
- **狀態**：已修（fix/backstage-ux）（前端部分）——使用者／角色編輯表單加上未儲存提醒（`useUnsavedChangesGuard`）；前端遇到不合法的時區不再丟 RangeError（退回預設時區）。延後：後端以 `Intl.supportedValuesOf` 驗證 timezone（後端組）、權限撤銷的 E2E（本次不跑 E2E）、重連 jitter 依在線人數放大（realtime／基礎設施）

## 已處理得好的地方

- **refresh token 輪替**：條件式 `markUsed` ＋ 同一交易發下一張、重用偵測、登出與續期同時提交的家族檢查，並有併發整合測試（`refresh-rotation.spec.ts`）。
- **多分頁續期**：前端以 Web Locks 跨分頁互斥、BroadcastChannel 分享新 token、epoch 防止登出後被晚到的續期救活、429／網路錯誤不結束 session（`SessionStore.ts`、`cross-tab.test.ts`、E2E「兩個分頁同時操作」）。
- **401 同時多個請求**：`renewAccessToken(rejected)` 單飛續期、只有仍是目前 token 才強制續期；只重試冪等方法，`/auth/refresh` 不自動重送。
- **審批併發**：`review()` 以 `WHERE status = 'pending'` 條件式更新先搶下請求再套用，輸家在建立任何資料前 rollback；待審請求有部分唯一索引，`submit` 的競態轉成「已有待審」；四眼原則。
- **角色權限變更採差異語意**（`add`/`remove`），避開整批取代的 lost update；快取失效在交易後、`PERMISSIONS_CHANGED` 先於 `RESOURCE_CHANGED`，符合規則 6。
- **角色刪除** 先查受影響者再刪（規則 7）；`user_roles` 在同一交易刪除。
- **資料夾結構寫入** 以交易層級 advisory lock 排隊，循環移動（A→B、B→A 同時）與同名競態都處理，唯一鍵衝突轉成 `FILE_FOLDER_NAME_CONFLICT`。
- **檔案**：改名有樂觀鎖（`FILE_VERSION_CONFLICT`）；`markReady`／`discardPending` 條件式更新處理 complete 與 abort 的競態；資料夾遞迴刪除時上傳中的檔案一併軟刪除，`complete` 不會讓它復活；物件刪除在交易後、失敗只留孤兒；0 byte、檔名控制字元與路徑分隔字元、`.`/`..` 都有驗證。
- **使用者／角色唯一鍵**：部分唯一索引（`WHERE deleted_at IS NULL`）讓軟刪除後可重用；email 用 `citext` 且 DTO 會 `trim`；預檢查與 INSERT 之間的競態由例外過濾器轉成 409。
- **停用／刪除使用者**：同一交易遞增 `token_version`、撤銷 refresh token，交易後失效快取並推 `SESSIONS_REVOKED` 斷開 socket；IdP session 一併結束。
- **背景工作**：交易內寫 outbox、提交後搬移，搬移以 outbox id 當工作 id 防重複；定期清掃補救；排程由 pg-boss 分散式鎖；租戶停用或刪除時略過而非無限重試；寄信在執行時再確認使用者狀態。
- **租戶生命週期**：狀態轉換以條件式更新（`transition(from)`）；停用「先改狀態再收尾」；佈建每一步冪等、失敗停在 `failed`；建立時的代碼／網域競態由唯一索引轉成業務錯誤。
- **稽核不可變**：`audit_logs` 的 UPDATE／DELETE trigger，冷熱搬移函式 `SKIP LOCKED`。
- **排序欄位白名單**、多欄排序去重、分頁 `limit` 上限、稽核查詢的日期範圍上限。

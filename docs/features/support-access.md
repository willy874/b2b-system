# 支援存取（代理登入）

- 優先度：P1
- 狀態：提案
- 依賴：身分範圍與登入流程（[`04-sso.md`](../architecture/04-sso.md) §1.1、§3.1；[`05-tenancy.md`](../architecture/05-tenancy.md) §10.2 D5、D9–D11、D19）；
  access token 與 `AccessTokenVerifier`（[`backend/04-auth.md`](../architecture/backend/04-auth.md) §1、§6、§11）；
  `PermissionsGuard` 與平台權限（[`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §3、§3.2，[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8）；
  撤銷與 room（[`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §3.5、§6）；兩邊的稽核（[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §3、§8.1）
- 相關：[`tenant-user-support.md`](./tenant-user-support.md)（同一批「平台協助租戶」的工具，那份是不進入租戶的救援）；
  [`maintenance-broadcast.md`](./maintenance-broadcast.md) 的唯讀維護、[`tenant-lifecycle.md`](./tenant-lifecycle.md) 的唯讀停權（三者都需要「擋下寫入」，§4 的機制應共用）；
  [`platform-dual-approval.md`](./platform-dual-approval.md)（寫入模式、緊急存取可能要雙人覆核）；[`platform-security-policy.md`](./platform-security-policy.md)（平台後台的 IP 白名單與 session 時效）；
  [`platform-dashboard.md`](./platform-dashboard.md)（進行中的支援 session 數）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

身分刻意分成兩份：平台管理者在平台 DB、租戶的使用者在各租戶 DB（[`05-tenancy.md`](../architecture/05-tenancy.md) §10.2 D5），
「平台的 super-admin 看不到任何租戶的內容（要看就得在該租戶有帳號）」，平台也看不到租戶的稽核（D19）。
`AccessTokenVerifier.verifyClaims` 在租戶網域只接受 `tid` 相符的 token，apps/platform 的 `/enter`（D11）只是跳到那個租戶的登入頁，
平台管理者沒有那個租戶的帳號就進不去。這是正確的預設，但客服與維運因此卡住：

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 客戶回報「某個列表少了一筆」「這頁一直轉圈」 | 請客戶截圖、錄影、描述步驟 | 來回好幾輪；問題常與資料或權限有關，截圖看不出來 |
| 要親眼重現 | 請租戶管理員替平台人員建一個帳號、給 `admin` 角色 | 帳號沒有期限、事後沒人刪；權限給太大；稽核上看起來是租戶自己的人，分不出是平台的支援 |
| 「為什麼他看不到 X」 | 請租戶管理員用權限說明（[`iam/08-explain.md`](../architecture/iam/08-explain.md)）查完轉述 | 平台人員無法自己看；租戶管理員不一定會用 |
| 客戶要求「你們的人進來過幾次、看了什麼」 | 沒有紀錄 | 合規稽核（例：存取個資的紀錄）答不出來 |
| 共用帳號、請客戶分享密碼 | 違反政策，但實際上會發生 | 完全沒有稽核，且繞過 MFA |

Google Workspace、Atlassian 的做法是 **由客戶先開放支援存取**（期限、範圍），廠商在期限內以可辨識的支援身分進入，兩邊都留下紀錄。
本提案要在不破壞「硬切分」（D1–D5）的前提下提供這條路，並把 D5、D19 的例外寫清楚。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 租戶端的支援授權：開放、期限、模式（唯讀／可寫入）、範圍、隨時撤銷（§1） | 租戶沒有授權時的「緊急存取」（break-glass，開放問題 7） |
| apps/platform 發起支援 session：必填理由、工單編號、時長（≤ 授權剩餘時間）；進入走 SSO（§2） | 對外 API（`/v1`）以支援身分呼叫：API token 不在範圍內 |
| 新的 token 形態（`act` claim）與 `AccessTokenVerifier` 的判定（§3） | 一次進入多個租戶、跨租戶的批次操作 |
| 唯讀的強制：權限集合 ＋ 方法層的預設拒絕 ＋ 個人範圍的端點一律拒絕（§4） | 畫面錄影、session replay |
| backstage 的支援橫幅與「結束支援」；租戶的設定頁；apps/platform 的支援頁（§6） | 欄位遮罩（支援人員看得到的個資照權限顯示，開放問題 2 的範圍控制） |
| 兩邊的稽核、通知租戶管理員、即時撤銷與到期（§5） | 支援人員以自己的身分留言、關注、收通知 |

## 使用者故事

**作為租戶的 super-admin，我希望開放 72 小時的唯讀支援存取，以便平台的客服能直接看到我回報的問題，而不必替他建帳號。**

- **Given** 我在「系統 → 安全性 → 支援存取」
- **When** 我選「唯讀」、期限 72 小時、填上備註「工單 #1234」，送出
- **Then** 頁面顯示「支援存取開放到 10/13 15:00」與撤銷鈕；租戶稽核記下 `supportAccess.grant`

**作為平台的客服，我希望在授權期間以支援身分進入那個租戶，以便重現問題。**

- **Given** 租戶開放了唯讀支援存取，我有 `supportSession:start`
- **When** 我在 apps/platform 的租戶詳情按「開始支援」，填理由與工單編號
- **Then** 我落在那個租戶的 backstage，頂端有固定的橫幅「平台支援（唯讀）：alice@ops — 剩 58 分鐘 — 結束支援」；
  看得到的頁面由授權的範圍決定，沒有任何新增、編輯、刪除的按鈕；租戶的 super-admin 收到站內通知

**作為平台的客服，我希望寫入被伺服器擋下，而不只是畫面上沒有按鈕，以便不會意外改到客戶的資料。**

- **Given** 唯讀的支援 session
- **When** 我（或任何拿到 token 的程式）送出 `PATCH /users/:id`、`POST /data-transfers/exports`、`POST /auth/api-tokens`
- **Then** 一律 `403 SUPPORT_READ_ONLY`，租戶稽核記下被擋的請求

**作為租戶的 super-admin，我希望隨時撤銷，以便支援人員立刻離開。**

- **Given** 一個進行中的支援 session
- **When** 我按「撤銷支援存取」
- **Then** 支援人員的分頁在幾秒內收到 `session.revoked` 並導向「支援已結束」頁；之後的請求一律 401；兩邊的稽核都記下是誰、何時撤銷

**作為租戶的稽核者，我希望在稽核日誌分辨「平台支援」做了什麼，以便回答客戶的合規詢問。**

- **Given** 上週有兩次支援 session
- **When** 我在稽核日誌篩選「平台支援」
- **Then** 看到每次的開始、結束、理由、平台人員的 email，以及期間存取過的資源

## 初步構想

### 1. 租戶端的授權（`support_access_grants`，租戶 DB）

授權是租戶的決定，資料放在租戶 DB（D19 的精神：租戶的事記在租戶）；平台需要的「哪些租戶目前開放」另見開放問題 6。

| 欄位 | 說明 |
| --- | --- |
| `mode` | `read` ｜ `write`（寫入模式是否存在見開放問題 4） |
| `role_id` | 支援身分的權限範圍（開放問題 2 的方案 B）；null ＝ 預設範圍 |
| `expires_at` | 上限由平台參數決定（例：最長 7 天） |
| `note` | 租戶填的備註（工單編號） |
| `created_by`、`revoked_at`、`revoked_by`、`version` | 同時只有一筆未撤銷、未到期的授權（partial unique index）；修改帶 `version` |

- 端點：`GET|PUT|DELETE /system/support-access`（`supportAccess:read`／`supportAccess:manage`），`GET /system/support-access/sessions`（這個租戶的支援 session 歷史，讀平台 DB 但只取這個租戶的列）。
- 租戶權限：`supportAccess:read`、`supportAccess:manage`；預設只有 super-admin 有 `manage`（與 `system:update` 同等級，`admin` 沒有）。
- 支援身分 **永遠不能** 呼叫上面這組端點：不能延長或改大自己的授權。

### 2. 進入流程（傾向沿用 SSO，開放問題 5）

```
apps/platform 租戶詳情 ?tab=support →「開始支援」
  └─ POST /platform/tenants/:id/support-sessions { reason, ticketRef, mode, durationMinutes }
       api：supportSession:start；以 Tenancy.run 讀租戶的授權（mode、到期）；
            平台 DB 建 support_sessions（status pending）→ 回 { sessionId, enterUrl }
  └─ 頂層跳轉 → 租戶網域 /auth/login?support=<sessionId>
backstage：與一般登入相同的 PKCE（§3.1），authorize 多帶 support=<sessionId>
       provider：IdP session 的帳號是 p:{adminId}、support session 屬於他、這個租戶、pending、未過期
                 → 不觸發 realm_mismatch（interactionPolicy() 加一條例外），授權碼的帳號 id 是 s:{tenantId}:{sessionId}
backstage /auth/callback → POST /api/auth/sso/callback
       api：parseAccountId 新增 realm 'support'；再檢查一次授權與 session → session 改 active、記 started_at
            → 發支援用的 access token ＋ 支援用的 refresh cookie（§3）
```

- 沿用 SSO 的好處：授權碼經 PKCE 綁定發起的分頁；進入的前提是 **瀏覽器上有平台管理者的 IdP session**，不是一張可以轉貼的網址。
- apps/platform 的 `/enter`（D11）不變：那是「以自己在租戶的帳號登入」；支援是另一個按鈕。

### 3. Token、session 與撤銷

| 項目 | 構想 |
| --- | --- |
| access token | `{ sub: <sessionId>, ver, jti, tid, act: { sub: 'p:<adminId>' }, smode: 'read'｜'write', exp }`；`act` 取自 RFC 8693 的「代表誰行動」。驗證時 `tid` 照舊必須等於網域的租戶 |
| 驗證 | `AccessTokenVerifier.checkUser` 看到 `act` 時改查平台 DB 的 `support_sessions`（`active`、未過期、授權未撤銷、平台管理者仍 `active`），結果進 `UserCacheService`，key 加前綴避免與使用者 id 混用 |
| `req.user` | `AuthUser` 加 `support?: { sessionId, adminId, adminEmail, mode }`；`setContextUser` 一併帶上，稽核由脈絡取得（§5） |
| refresh | 不寫租戶的 `refresh_tokens`（`user_id` 是 `users` 的外鍵）；另一個 cookie 名稱與 path（例：`support_refresh`、`/api/auth/support`），不覆蓋同一瀏覽器上本人在這個租戶的 session |
| 壽命 | session 最長 4 小時（平台參數），且不超過授權的 `expires_at`；access token 照舊 5 分鐘，續期時重新檢查授權 |
| 撤銷 | 租戶撤銷授權、平台結束 session、平台管理者被停用或改密碼、租戶停用 → `SESSIONS_REVOKED` 新增 `supportSessionIds`，推到新的 room `support:{sessionId}` 並斷線；`UserCacheService` 失效並經 `BroadcastService` 通知其他程序 |
| 推播 | handshake 接受支援 token：加入 `t:{tid}`（租戶停用時一起斷）、權限集合對應的 perm room、`support:{sessionId}`；**不** 加入任何使用者的 room；`channel.relay` 拒絕 |
| 速率限制 | `RateLimitGuard` 已登入時以「租戶＋使用者」計數，這裡以 session id 計 |

### 4. 唯讀的強制（三層）

1. **權限集合**：`PermissionsGuard` 對支援身分不查 `permissionService.getPermissionSet(userId)`（沒有這個使用者），改用授權範圍算出的集合，
   唯讀時再過濾成只有讀取鍵（不含 `*:export`、`user:resetMfa` 這類）。`/auth/profile` 的 `permissions` 同一份，前端的按鈕自然不出現。
2. **方法層的預設拒絕**：新的全域 guard（排在 `JwtAuthGuard` 之後），唯讀的支援身分遇到 `GET`／`HEAD` 以外的方法一律 `403 SUPPORT_READ_ONLY`；
   語意是讀取的 `POST`（`/announcements/audience-preview`、`/approval-flows/:type/preview`、`/mfa/policy/preview`）放行。
   這一層與 [`tenant-lifecycle.md`](./tenant-lifecycle.md) §2 的 `TenantWriteGuard` 共用同一個 guard 與放行標記 `@AllowWhenReadOnly`（例外清單只維護一份），
   本提案只多一個限制來源「這條 session 唯讀」；但租戶唯讀放行的帳號安全與個人狀態寫入，對支援身分一律不放行（見第 3 點）。會寫入的 `GET`（若有）三者都要擋。
3. **個人範圍一律拒絕**：`@Authenticated()` 的端點不經權限判斷（`PermissionsGuard` 直接放行），支援身分在租戶裡沒有「自己」：
   除了 `GET /auth/profile` 與登出，`/auth/*`、`/me/*`、`/notifications`、`/auth/api-tokens`、`/auth/mfa/*`、資料匯出入（`data-transfer` 有 16 個 `@Authenticated()` 路由）都拒絕。

測試：以 `openapi.json` 列出所有路由，帶唯讀支援 token 逐一呼叫非 `GET` 的路由，預期全部 `403`（漏標 `@AllowWhenReadOnly` 只會多擋，不會漏放）。

### 5. 稽核與通知

| 位置 | 動作 |
| --- | --- |
| 平台 `platform_audit_logs` | `supportSession.start`（理由、工單、模式、租戶）、`supportSession.end`（`reason`：`logout`／`expired`／`revokedByTenant`／`revokedByPlatform`）、拒絕的 `authz.denied` |
| 租戶 `audit_logs` | `supportAccess.grant`／`update`／`revoke`（租戶管理員）；`support.sessionStart`／`sessionEnd`；支援身分的每一筆稽核 `actorId = null`、`actorEmail = 'support:<admin email>'`、`metadata.support = { sessionId, adminId, ticketRef }`；被擋的寫入記 `support.denied` |
| 讀取的紀錄 | [`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §2.2 不記 `GET`；支援 session 是例外，粒度見開放問題 9 |

- 稽核的 `actorId` 是 uuid 而且沒有外鍵，但填 session id 會讓「依操作者篩選」把它當成使用者；傾向填 null，以 `metadata.support` 篩選（稽核列表加「平台支援」篩選）。
- 開始時以 `NotificationService.notify` 通知持有 `supportAccess:manage` 的人（新的通知類型，可在事件管理關閉）；授權到期前一天提醒建立授權的人。
- 租戶用量（[`05-tenancy.md`](../architecture/05-tenancy.md) §5.4）：支援的請求照常計入，`UsageMeter` 不區分。

### 6. 前端

- **backstage**：`/auth/profile` 加 `support: { adminEmail, mode, expiresAt, ticketRef } | null`。web-core 的 `DashboardShell` 有 `support` 時在頂列上方顯示固定橫幅
  （Design Token 的警示色、倒數、「結束支援」＝登出支援 session 後關閉分頁）；帳號選單只留「結束支援」。`SessionWatcher` 把 `SUPPORT_SESSION_ENDED` 導到「支援已結束」頁，不導向登入。
  租戶的設定頁：`features/security`（`/system/security`）加「支援存取」分頁：目前的授權、進行中的 session（可撤銷）、歷史。
- **apps/platform**：租戶詳情加 `?tab=support`（授權狀態、開始支援、這個租戶的 session 歷史）；新頁 `/support-session`（所有進行中的 session，可強制結束）。
  側欄放「租戶」群組。開始支援的對話框必填理由、顯示授權的模式與剩餘時間。

### 7. 平台權限與錯誤

| 平台權限鍵 | 說明 | 傾向的角色 |
| --- | --- | --- |
| `supportSession:read` | 支援 session 列表、各租戶的授權狀態 | 三種角色都有 |
| `supportSession:start` | 以唯讀模式進入有授權的租戶 | `super-admin`、`operator`（或新的 `support` 角色，開放問題 8） |
| `supportSession:startWrite` | 以寫入模式進入（授權本身也要允許） | `super-admin` |
| `supportSession:revoke` | 結束別人的支援 session | `super-admin`、`operator` |

錯誤碼：`409 SUPPORT_ACCESS_NOT_GRANTED`（沒有授權或模式不允許）、`401 SUPPORT_SESSION_ENDED`（`details.reason`）、`403 SUPPORT_READ_ONLY`、
`403 SUPPORT_ACTION_FORBIDDEN`（寫入模式下仍禁止的動作，見「安全風險」第 4 點）。

### 8. 會動到的既有程式

`common/auth/access-token.verifier.ts`（`act`）、`common/guards/permissions.guard.ts`、新的唯讀 guard 與 `app.module.ts` 的 `APP_GUARD` 順序、
`common/route-audit.ts`（新裝飾器）、`modules/oidc-provider/oidc-account.ts`（`s:` 帳號）與 `oidc-provider.service.ts` 的 `interactionPolicy()`、
`modules/auth/sso.service.ts` 的 `callback`、`modules/realtime`（room、`SESSIONS_REVOKED`）、`packages/realtime` 的 `SessionRevokedReason`、
`modules/audit-log/audit.service.ts`、`db/seeds/platform-permissions.ts`、`packages/error-codes`、web-core 的 shell 與 session。

## 安全風險

這是整個平台風險最高的功能：它在硬切分上開一道門。每一項都要在「規劃中」之前有對策。

1. **平台帳號被盜 ＝ 所有開放授權的租戶被看光**。對策：租戶先開放（預設關閉）、有期限；進入前要求平台管理者近期完成 MFA（step-up）；
   通知租戶管理員；[`platform-security-policy.md`](./platform-security-policy.md) 的 IP 白名單只套在 apps/platform 網域，而支援 session 走的是租戶網域，要另外限制來源 IP。
2. **token 混用**：支援 token 拿到別的租戶 → `tid` 擋下；拿到 apps/platform → `realm` 擋下。簽章用租戶的金鑰環還是獨立的 `SUPPORT_JWT_SIGNING_KEYS`（比照 [`backend/04-auth.md`](../architecture/backend/04-auth.md) §11 D4 的縱深防禦）是開放問題 11。
3. **寫入從縫隙漏出**：有副作用的 `GET`、`@Authenticated()` 的個人端點、WebSocket 訊息（`channel.relay`）、presigned 網址的下載、匯出產生的檔案、觸發 Webhook 的動作。§4 的預設拒絕是主要防線，權限集合只是第二道。
4. **寫入模式下的提權**：即使開放寫入，支援身分也永遠不能改使用者的角色、權限鍵、MFA、外部 IdP、API token、服務帳號、支援授權本身（固定的拒絕清單，`SUPPORT_ACTION_FORBIDDEN`）。
5. **以「使用者」為 key 的快取與 room**：`UserCacheService`、權限快取 `{tenantId}:{userId}`、使用者 room 都假設 id 是 `users.id`；支援 session 的 id 必須走不同的命名空間，否則撞到同 id 的使用者會共用快取。
6. **cookie 與同一個瀏覽器**：平台人員若在同一租戶也有自己的帳號，支援的 refresh cookie 不能覆蓋或接手本人的 session；結束支援要清掉自己的 cookie。
7. **個資**：支援人員看得到的就是授權範圍內的全部資料；這是租戶在授權時決定的，畫面上要寫清楚「開放後平台人員能看到哪些頁面」。
8. **稽核的完整性**：稽核寫不進去時，支援的寫入也不能生效（與一般寫入相同，稽核在交易內）；讀取的紀錄若在交易外，失敗只記 log（開放問題 9）。

## 開放問題

進入「規劃中」之前，每一條都要有結論（寫在該條下方，不要刪掉問題）。

1. **身分怎麼表示**：A. 支援身分本身（`sub` 是 session、`act` 是平台管理者，權限來自授權範圍）；B. 代理某位具體使用者（`sub` 是他、`act` 是平台管理者，看到他看到的）；
   C. 以 A 為主，唯讀時可選「以某人的權限檢視」（只借權限集合，不借他的個人範圍、通知、草稿）。B 最貼近「重現他的問題」，但代理的人做了什麼會混進那位使用者的紀錄，且個人範圍（他的通知、他的待審）也被看見。傾向 C。
2. **唯讀的權限集合**：A. 所有開放的 feature 的 `:read` 鍵；B. 租戶在授權時選一個角色（預設 `auditor`），唯讀時再過濾成讀取鍵；C. 代理對象的權限 ∩ 讀取鍵（只在 1-B／1-C）。傾向 B（範圍由租戶決定、沿用角色編輯器）。
3. **寫入怎麼擋**：A. 只靠權限集合（唯讀＝只給讀取鍵）；B. 方法層的預設拒絕 ＋ 放行的裝飾器（§4）；C. 每個路由都標記讀或寫，`route-audit` 強制。A 擋不住 `@Authenticated()` 的路由；C 最完整但要標幾百個路由。傾向 B，C 作為之後的強化。
4. **要不要有寫入模式**：A. 這一版只有唯讀；B. 有，但要租戶的授權明確允許、`supportSession:startWrite`、每次寫入另記；C. 有，再加 [`platform-dual-approval.md`](./platform-dual-approval.md) 的雙人覆核。傾向 A，先上線唯讀。
5. **進入流程**：A. 沿用 SSO（§2，authorize 帶 `support`、帳號 id `s:`）；B. apps/platform 簽一次性入場票，經網址 fragment 帶到 backstage 兌換；C. 在租戶 DB 建影子帳號（`users.kind` 加 `support`）走一般登入。
   B 的票是可轉貼的 bearer；C 讓平台的人出現在租戶的使用者列表、外鍵都成立，但違反 D5「兩份身分」。傾向 A。
6. **授權存在哪**：A. 只在租戶 DB（平台每次進入時 `Tenancy.run` 讀）；B. 只在平台 DB（`tenants` 上的欄位，租戶管理員經租戶網域寫入）；C. 租戶 DB 為準，平台 DB 留快照給列表與 [`platform-dashboard.md`](./platform-dashboard.md)。
   A 讓「哪些租戶目前開放」需要逐一進入租戶，重蹈 D11 理由裡的跨租戶掃描。傾向 C。
7. **租戶沒有授權時的緊急存取**：A. 不做；B. 平台 `super-admin` 經雙人覆核可以進入，事後立即通知租戶並寫高嚴重度稽核；C. 合約層面處理，系統不提供。傾向 A（這一版），B 留給雙人覆核上線後再評估。
8. **平台角色**：A. 給既有的 `operator`；B. 新增 `support` 角色（`tenant:read`、`supportSession:read`／`start`，沒有 `tenant:update`）；平台角色是固定的列舉（`platform_admin_role`），新增要 migration 與 seed。傾向 B：客服不該能停用租戶。
9. **讀取的稽核粒度**：A. 只記開始與結束；B. 每個請求一筆（方法、路由、資源 id）；C. 每個請求記在 session 的明細（平台 DB），租戶的稽核只記摘要與連結。B 最能回答「看了什麼」，但會讓租戶的熱表在支援期間暴增。傾向 B，並以 session 時長上限控制量。
10. **是否做成可關閉的 feature**（`TENANT_FEATURES` 加 `supportAccess`，[`05-tenancy.md`](../architecture/05-tenancy.md) §12、§15）：A. 是，平台可以不提供給某些租戶（關閉時租戶的設定頁不出現）；B. 否，所有租戶都有授權頁。傾向 A，預設開放。
11. **簽章金鑰**：A. 沿用租戶的金鑰環（`JWT_SIGNING_KEYS`）；B. 獨立的金鑰環，租戶網域在看到 `act` 時只用它驗。傾向 B（縱深防禦，部署多一個秘密）。
12. **檔案內容與匯出**：唯讀時能不能下載檔案（presigned 網址）、能不能匯出？A. 都不行；B. 能預覽、不能下載與匯出；C. 依授權範圍。傾向 B。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

完成後預計寫成：

- `docs/architecture/iam/09-support-access.md`（授權、身分、權限、唯讀的強制、稽核、安全風險；設計決策在最後一章）
- [`04-sso.md`](../architecture/04-sso.md) §1.1、§3 補上支援的帳號 id 與進入流程；[`05-tenancy.md`](../architecture/05-tenancy.md) §10.2 D5、D19 註明例外
- [`backend/04-auth.md`](../architecture/backend/04-auth.md) §1、§6（`act`）、[`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §3、[`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §3.5、§6、[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §2、§8.1
- [`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §2（`supportAccess`）、§8（`supportSession:*`）

# 平台的安全政策

- 優先度：P2
- 狀態：提案
- 依賴：平台管理者的登入與 session（[`backend/04-auth.md`](../architecture/backend/04-auth.md) §2.6、§3.3、[`04-sso.md`](../architecture/04-sso.md) §1.1）；
  MFA 的平台政策與租戶政策（[`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §5、§6、§13、§15.1 D10、D11）；系統設定（[`backend/12-settings.md`](../architecture/backend/12-settings.md)）；
  兩層設定的先例（[`backend/09-file.md`](../architecture/backend/09-file.md) §16.9、§17.1）；客戶端 IP 的判定（[`01-system.md`](../architecture/01-system.md) §4.2 的客戶端 IP、`TRUST_PROXY` 與 `TRUSTED_PROXY_CIDRS`）
- 相關：[`tenant-plans.md`](./tenant-plans.md)（底線是否隨方案不同）、[`support-access.md`](./support-access.md)（是否允許支援存取可能是底線的一項）、
  [`platform-dual-approval.md`](./platform-dual-approval.md)（放寬政策本身是否要覆核）、[`tenant-lifecycle.md`](./tenant-lifecycle.md)（新租戶建立時套用的初始值）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

平台管理者的權限涵蓋所有租戶，但保護他們的設定散在環境變數與程式常數裡；租戶的安全政策則完全由租戶自己決定，平台沒有辦法要求最低標準。

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 只允許公司 VPN 進 apps/platform | 沒有機制；只能在 LB 或 nginx 擋 | 改網段要動部署；LB 擋不到「已經登入、換了網路」的 session |
| 平台管理者的 session 太長 | 與租戶共用 `REFRESH_TOKEN_TTL`（7 天，實際上就是閒置時效）、`REFRESH_FAMILY_MAX_AGE`（30 天）、`OIDC_TTL.Session`（7 天，程式常數） | 權限最大的帳號與一般使用者一樣，閒置一週仍不必重新登入；要縮短得同時縮短所有租戶 |
| 同一位平台管理者在多處登入 | 沒有上限，也沒有列出 session 的畫面 | 帳號外洩時無從察覺 |
| 平台管理者的登入鎖定、密碼長度 | env `LOGIN_MAX_ATTEMPTS`／`LOGIN_LOCKOUT_SECONDS`、`PasswordSchema` 固定 12 | 系統設定的 `auth.*` 平台管理者不讀（[`backend/12-settings.md`](../architecture/backend/12-settings.md) §3），調整要重新部署 |
| 平台管理者的 MFA | `PLATFORM_MFA_REQUIRED`、`PLATFORM_MFA_METHODS`（[`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §13，D10 刻意不提供執行期放寬） | 合理，但沒有地方看到「目前的生效值」與「誰還沒設定」 |
| 客戶要求「所有租戶至少 14 碼密碼、管理員必須 MFA」 | 逐一請租戶調整 `auth.passwordMinLength`、`mfa_policy` | 租戶隨時可以改回去；平台看不到哪些租戶不符合 |

租戶端已有的安全相關設定（全部在租戶 DB，平台不能約束）：

| 設定 | 位置 | 現在的範圍 |
| --- | --- | --- |
| `auth.passwordMinLength` | `modules/credential/auth.settings.ts` | 12–64，DTO 的 `PasswordSchema` 先擋 12，`AuthService.assertPasswordPolicy` 再依設定檢查 |
| `auth.loginMaxAttempts`、`auth.loginLockoutSeconds` | 同上 | 3–20 次、60–86400 秒 |
| `auth.registrationEnabled` | 同上 | boolean |
| `auth.personalTokenMaxDays`、`auth.serviceAccountTokenMaxDays` | `modules/api-token/api-token.settings.ts` | 1–90、1–365 天 |
| MFA 政策（`requireAll`、`requiredRoleIds`、`allowedMethods`） | `mfa_policy`（[`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §6） | 專門的表，`mfaPolicy:update` 預設只給 super-admin |
| 外部 IdP | 平台的租戶 feature `identityProvider`（[`05-tenancy.md`](../architecture/05-tenancy.md) §5.1） | 已經由平台決定 |
| session 時效 | 不是租戶設定（[`backend/12-settings.md`](../architecture/backend/12-settings.md) §3「不搬進來的值」） | 所有租戶共用 env |

注意 [`backend/04-auth.md`](../architecture/backend/04-auth.md) §4.2 刻意 **不要求複雜度組合**（NIST SP 800-63B）；底線若加「複雜度」會與既有決定衝突（開放問題 6）。

## 範圍

建議分兩階段：A 只動平台自己（平台 DB、apps/platform），B 才跨進每個租戶的讀取路徑。

| 做 | 不做（這一版） |
| --- | --- |
| A：平台後台的存取政策——IP 白名單（CIDR）、閒置與絕對時效、同時 session 數、登入鎖定、密碼最短長度；兩層設定（env 是能力與上限，平台 DB 是執行期覆寫） | 在畫面上放寬平台管理者的 MFA（維持 [`backend/21-mfa.md`](../architecture/backend/21-mfa.md) D10：只能收緊） |
| A：平台管理者的 session 清單與撤銷（自己的、別人的） | 依國家、ASN、裝置指紋的存取限制 |
| A：鎖死自己的防呆與 CLI 救援 | 在 nginx／LB 層同步白名單（白名單在 api 判斷） |
| B：租戶安全底線——密碼最短長度、MFA 必須啟用的範圍、登入鎖定的下限、API token 期限上限；租戶在底線之上調整 | 每個租戶各自的 session 時效（先要把 OIDC 的 TTL 改成依請求計算，另案） |
| B：apps/platform 列出不符合底線的租戶；backstage 的設定頁顯示「平台要求至少 …」 | 租戶的 IP 白名單（租戶自己的存取限制，另案；與 `rateLimit.trustedCidrs` 的放寬不同） |
| 平台權限鍵、平台稽核、跨程序廣播 | 依方案自動帶入底線（等 [`tenant-plans.md`](./tenant-plans.md) 定案，開放問題 5） |

## 使用者故事

**作為平台的 super-admin，我希望只有公司網段能進 apps/platform，以便帳號外洩時外部也登不進來。**

- **Given** 部署允許 IP 白名單（`PLATFORM_IP_ALLOWLIST_ENABLED=true`），我從 `203.0.113.10` 連線
- **When** 我在「安全政策」填入 `203.0.113.0/24, 198.51.100.0/24` 並儲存
- **Then** 不在網段內的登入互動回 `403 PLATFORM_IP_NOT_ALLOWED`、已登入的 session 下一個請求也被擋；所有程序在幾秒內生效；平台稽核記 `platformSecurity.update`（`high`）

**作為平台的 super-admin，我希望儲存時就知道會不會把自己鎖在外面。**

- **Given** 我目前的來源 IP 是 `203.0.113.10`
- **When** 我送出不含它的白名單
- **Then** 回 `409 PLATFORM_SECURITY_SELF_LOCKOUT`，畫面顯示「你目前的 IP 不在清單內」；不提供略過

**作為值班人員，我希望白名單設錯、所有人都進不去時有救援方式。**

- **Given** 網段變更後沒有任何平台管理者能登入
- **When** 有資料庫存取權的人執行 `cli:platform-security --clear-ip-allowlist --confirm <平台 database 名稱>`
- **Then** 白名單清空（回到「不限制」）、寫平台稽核（操作者記為 CLI），其他程序經廣播或 `TENANT_CACHE_TTL` 內生效

**作為平台管理者，我希望要求所有租戶的管理者都啟用 MFA，以便符合客戶的稽核要求。**

- **Given** 底線設定「持有 `role:grantPermission` 的人必須啟用 MFA」，某租戶的 `mfa_policy` 不要求任何人
- **When** 該租戶的 admin 下一次登入
- **Then** 被要求設定 MFA（與租戶政策要求時相同）；租戶的安全性分頁顯示「平台要求：…」且不能取消；apps/platform 的租戶清單在那個租戶標出「有 N 人不符合」

**作為租戶的 super-admin，我希望知道為什麼密碼長度不能設回 12。**

- **Given** 平台底線 `passwordMinLength = 14`，我們之前存的是 12
- **When** 我打開系統設定
- **Then** 生效值顯示 14、標示「平台要求至少 14」；可選範圍 14–64；存的 12 不被改寫，平台調回底線後恢復

## 初步構想

### 1. 哪些設定放哪一層（階段 A，平台後台）

| 設定 | 層 | 說明 |
| --- | --- | --- |
| `PLATFORM_MFA_REQUIRED`、`PLATFORM_MFA_METHODS` | env（不變） | D10：production 不能關；畫面只顯示生效值。執行期能否 **再收緊** 方式見開放問題 3 |
| `PLATFORM_IP_ALLOWLIST_ENABLED`（新） | env → **能力** | 部署是否允許 api 依來源 IP 擋平台的請求；沒開時頁面說明「這個部署沒有啟用 IP 白名單」，因為 `TRUST_PROXY`／`TRUSTED_PROXY_CIDRS` 沒設對時 IP 不可信 |
| `PLATFORM_IP_ALLOWLIST`（新，選填） | env → **緊急覆寫** | 有值時蓋過 DB，畫面唯讀；救援的第二條路（開放問題 2） |
| IP 白名單 | 平台 DB | CIDR 清單，空 = 不限制 |
| 閒置時效 | 平台 DB（≤ `REFRESH_TOKEN_TTL`） | 平台 refresh token 的壽命；env 是上限 |
| 絕對時效 | 平台 DB（≤ `REFRESH_FAMILY_MAX_AGE`） | 平台 refresh 家族的壽命；env 是上限 |
| 同時 session 數 | 平台 DB（1–20，null = 不限） | 以 `platform_refresh_tokens` 的有效家族計 |
| 登入鎖定 | 平台 DB（下限 3 次、60 秒） | 沒設定時用 env `LOGIN_MAX_ATTEMPTS`／`LOGIN_LOCKOUT_SECONDS` |
| 密碼最短長度 | 平台 DB（12–64） | `PlatformAdminService` 設定密碼時檢查，比照 `assertPasswordPolicy` |

**生效值**（`PlatformSecurityPolicy`，`core/` 新增，同步讀取）：`effective = row?.x ?? env 預設`，再以 env 的上限裁切（`min(row.idle, REFRESH_TOKEN_TTL)`），讀取時裁切、不改寫 DB，與 [`backend/09-file.md`](../architecture/backend/09-file.md) §16.9 相同。**沒有列時行為與現在完全相同**。
啟動時載入，寫入後本機重讀並以 `BroadcastService.channel('platform_security')` 通知其他程序，`TENANT_CACHE_TTL` 兜底。

### 2. IP 白名單的判斷點

- 客戶端 IP 一律用 `req.ip`（Express 依 `TRUST_PROXY` 算出；nginx 依 `TRUSTED_PROXY_CIDRS` 只採用前置 LB 的 `X-Forwarded-For`，[`01-system.md`](../architecture/01-system.md) §4.2）。多實例時每個實例算法相同，不需要共享狀態。
- 擋在三處：平台登入互動的密碼驗證（`PlatformAdminService.verifyCredentials` 之前）、平台的 refresh（`/platform/auth/refresh`）、`realm: 'platform'` 的 access token（`JwtAuthGuard` 之後的平台檢查）。WebSocket handshake 是否也擋見開放問題 4。
- `RATE_LIMIT_EXEMPT_CIDRS` 與白名單無關：豁免限流不等於允許登入。
- 被擋的請求計入 `api_platform_ip_denied_total` 並寫平台稽核 `authz.denied`（`reason: 'ip'`），同一 IP 每分鐘最多一筆，避免掃描灌爆稽核。

### 3. 資料模型（平台 DB）

`platform_security_policy`：單列（`key = 'default'`，`CHECK`），比照 `mfa_policy`、`cdn_settings`。

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `ip_allowlist` | `text[]`，可為 null | null／空 = 不限制 |
| `idle_ttl_seconds`、`absolute_ttl_seconds` | integer，可為 null | null = 用 env |
| `max_sessions` | integer，可為 null | null = 不限 |
| `login_max_attempts`、`login_lockout_seconds`、`password_min_length` | integer，可為 null | null = 用 env 或 12 |
| `tenant_baseline` | jsonb，預設 `{}` | 階段 B 的底線 `{ [key]: number \| boolean \| string[] }`；不認得的 key 讀取時忽略 |
| `version`、`updated_by`、`updated_at` | | 樂觀鎖（`409 PLATFORM_SECURITY_VERSION_CONFLICT`） |

session 清單直接讀 `platform_refresh_tokens`（每個家族一列有效的最新 token），已有 `user_agent`、`ip_address`、`family_created_at`；「最後使用時間」取家族最新一張的建立時間，不必加欄。

### 4. 租戶底線（階段 B）

| 底線 key | 對應的租戶設定 | 合併方式 |
| --- | --- | --- |
| `passwordMinLength` | `auth.passwordMinLength` | `max(租戶, 底線)` |
| `loginMaxAttempts` | `auth.loginMaxAttempts` | `min(租戶, 底線)`（次數越少越嚴） |
| `loginLockoutSeconds` | `auth.loginLockoutSeconds` | `max` |
| `personalTokenMaxDays`、`serviceAccountTokenMaxDays` | `auth.*TokenMaxDays` | `min` |
| `registrationAllowed` | `auth.registrationEnabled` | 底線 `false` 時一律關 |
| `mfaRequiredFor` | `mfa_policy` | `none` ｜ `privileged`（持有可以授權的權限，開放問題 7）｜ `all`；與租戶政策取聯集 |

- **機制**：`SettingDefinition` 加選用的 `baseline: { key, merge: 'max' | 'min' | 'and' }`；`SettingService.get` 回傳 **合併後** 的生效值，`GET /system/settings` 另帶 `baseline` 與調整後的 `minimum`／`maximum`。schema 在啟動時只算一次（`resolveSetting`），底線是執行期的值，所以不能寫進 schema，只能在讀取與 `PATCH` 驗證時套用。
- **底線提高時**：既有的覆寫值不改寫；讀取時合併，畫面標示「平台要求至少 …（你們存的是 12）」。底線降回之後租戶原本的選擇自動恢復（與 CDN 的「讀取時裁切」同理）。
- **`PATCH` 低於底線**：回 `400 VALIDATION_FAILED`，`fields['values.<key>'] = 'SETTING_BELOW_BASELINE'`、`details.baseline`；或接受後照樣合併（開放問題 1）。
- **MFA**：`MfaLoginService.requirementFor` 在租戶政策之外再看底線；`/mfa/policy` 的 `GET` 帶 `baseline`，`PUT` 不能放寬到底線以下。底線提高時「不踢人、下一次登入才要求」，與 [`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §6 相同；改之前以 `POST /platform/security/baseline/preview` 逐一進租戶（`Tenancy.run`）算受影響人數，比照 §5 的 `impact`。
- **底線的快取**：隨 `PlatformSecurityPolicy` 載入；是否允許依租戶覆寫底線見開放問題 5。

### 5. 權限、稽核、端點

| 權限鍵 | 說明 | `super-admin` | `operator` | `auditor` |
| --- | --- | :-: | :-: | :-: |
| `platformSecurity:read` | 安全政策頁、生效值、不符合底線的租戶 | ✅ | ✅ | ✅ |
| `platformSecurity:update` | 平台後台的存取政策與租戶底線 | ✅ | | |
| `platformSession:revoke` | 撤銷 **別人** 的平台 session（自己的不需要權限） | ✅ | | |

| 方法 | 路徑 | 權限 | 說明 |
| --- | --- | --- | --- |
| GET | `/platform/security` | `platformSecurity:read` | `{ deployment（env 的能力與上限）, stored, effective, currentIp, version }` |
| PUT | `/platform/security` | `platformSecurity:update` | 只帶要改的欄位與 `version`；`null` 回到 env；白名單不含 `currentIp` 回 `409 PLATFORM_SECURITY_SELF_LOCKOUT` |
| POST | `/platform/security/baseline/preview` | `platformSecurity:read` | 套用後各租戶不符合的設定與人數 |
| GET／DELETE | `/platform/auth/sessions`、`/platform/auth/sessions/:id` | `@Authenticated()` | 自己的 session |
| GET／DELETE | `/platform/admins/:id/sessions[/:sessionId]` | `platformAdmin:read`／`platformSession:revoke` | 別人的 session |

稽核：`platformSecurity.update`（`before`／`after` 為存放值；白名單、時效、MFA 底線變更時 `high`）、`platformSession.revoke`、`authz.denied`（`reason: 'ip'`）。錯誤碼依 CLAUDE.md 同步 `packages/error-codes` 與 `web-core` 的 `ERROR_MESSAGE_KEY`。

### 6. 前端

- apps/platform `features/security`（route `/security`，側欄「系統管理」群組，與 CDN 同組）：部署資訊（唯讀）、存取限制（白名單、時效、session 數）、帳號政策（鎖定、密碼長度、MFA 生效值與「尚未設定 MFA 的管理者」）、租戶底線（含預覽與不符合的租戶清單）。
- apps/platform 的帳號頁加「登入中的裝置」；平台管理者詳情加 session 清單。
- backstage 的系統設定與安全性分頁（`/system/security`）顯示底線提示與收窄後的範圍。

### 7. 會動到的既有模組

| 位置 | 改動 |
| --- | --- |
| `apps/api/src/core/config/env.schema.ts` | `PLATFORM_IP_ALLOWLIST_ENABLED`、`PLATFORM_IP_ALLOWLIST` |
| `apps/api/src/core/`（新 `platform-security/`） | `PlatformSecurityPolicy`：載入、生效值、廣播 |
| `apps/api/src/modules/auth/platform-auth.service.ts`、`modules/platform-admin/` | refresh 時效改讀生效值、session 數上限與清單、密碼與鎖定政策、IP 檢查 |
| `apps/api/src/common/guards/jwt-auth.guard.ts`（或新 guard） | 平台 realm 的 IP 檢查 |
| `apps/api/src/core/settings/setting-definition.ts`、`setting.service.ts` | `baseline` 合併（階段 B） |
| `apps/api/src/modules/mfa/mfa-login.service.ts`、`mfa-policy.service.ts` | 底線的 MFA 要求 |
| `apps/api/src/cli/`（新 `platform-security.ts`） | 清空白名單、重設時效 |
| `apps/api/src/db/platform` | `platform_security_policy`（下一個平台 migration） |
| `apps/api/src/db/seeds/platform-permissions.ts`、`docs/architecture/iam/02-permission-catalog.md` §8 | 三個權限鍵 |
| `apps/platform/src/features/security`（新）、`account`、`platform-admin` | 頁面、session 清單 |
| `apps/backstage/src/features/system` | 底線提示 |

## 開放問題

進入「規劃中」之前，每一條都要有結論（寫在該條下方，不要刪掉問題）。

1. **租戶存的值低於底線時，`PATCH` 拒絕還是接受？** 讀取一律取合併後的值（不改寫 DB）。寫入：(a) 拒絕，`SETTING_BELOW_BASELINE`——語意清楚；(b) 接受但照樣合併——底線降回時租戶的選擇馬上生效。傾向 (a)：畫面的範圍已經收窄，接受一個不會生效的值只會讓人困惑。
2. **鎖死自己的救援**：除了儲存時的 `SELF_LOCKOUT` 檢查，(a) CLI `cli:platform-security`（需要 DB 存取權，與 `cli:reset-super-admin` 同等級）；(b) env `PLATFORM_IP_ALLOWLIST` 蓋過 DB（要重啟）；(c) 兩者都有。傾向 (a)：一條路比較好稽核；env 覆寫會讓畫面上的值與實際不一致。另需決定 CLI 是否一併能重設時效與 session 上限。
3. **平台管理者的 MFA 要不要搬進 DB？** D10 的理由是「不提供執行期放寬」。選項：(a) 維持 env，畫面唯讀；(b) DB 只能 **收緊**（例如從 `PLATFORM_MFA_METHODS` 中再拿掉 email），不能關閉要求。傾向 (a)：平台管理者人數少，收緊方式的需求不明確。
4. **IP 白名單是否擋 WebSocket 與已簽發的 access token？** access token 只活 `JWT_ACCESS_TTL`（300 秒），只擋 refresh 就最多 5 分鐘後失效；每個請求都擋則要在 guard 多一次 CIDR 比對（成本很低）。傾向每個請求都擋（含 handshake），換網路的 session 立刻失效。
5. **底線是全平台一份，還是可以依租戶（或依 [`tenant-plans.md`](./tenant-plans.md) 的方案）不同？** (a) 全平台一份；(b) 全平台 ＋ 租戶層覆寫（只能更嚴，放在 `tenants.feature_params` 或新欄）；(c) 跟著方案。傾向先 (a)，方案定案後再看 (c)；(b) 會讓「這個租戶的要求」散在三處。
6. **底線要不要包含「密碼複雜度」？** [`backend/04-auth.md`](../architecture/backend/04-auth.md) §4.2 依 NIST 不要求組合。客戶合約若明文要求，選項：(a) 不提供，以長度 ＋ 常見密碼替代並在文件說明；(b) 提供選用的「至少 N 種字元類別」。傾向 (a)。
7. **MFA 底線的「管理者」怎麼定義？** 租戶的角色是自訂的，平台不能指名角色 id。選項：(a) 系統角色 `super-admin`；(b) 持有任一「授權類」權限（`role:grantPermission`、`user:assignRole` 等，清單在程式碼）的人；(c) 只提供 `none`／`all`。傾向 (b)，但要確認經由群組取得的權限也算在內，並估計每次登入多一次權限解析的成本。
8. **同時 session 數超過時怎麼辦？** (a) 登入成功、撤銷最舊的家族；(b) 拒絕登入並列出現有 session。傾向 (a)：(b) 在忘記登出的電腦上會把自己擋住。
9. **改安全政策本身要不要雙人覆核？** 放寬白名單、拿掉 MFA 底線是高風險操作，可以交給 [`platform-dual-approval.md`](./platform-dual-approval.md)；但事故時收緊（加白名單、縮時效）不該等覆核。傾向「放寬要覆核、收緊不必」，等該提案定義機制後再決定。
10. **支援存取是否列入底線？** [`support-access.md`](./support-access.md) 若讓租戶決定是否允許平台進入，平台是否能以底線強制「一律允許」或「一律需要租戶同意」？兩份提案要一起決定，避免各自一個開關。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

完成後預計寫成：

- `docs/architecture/backend/` 新的一份「平台的安全政策」：兩層設定與生效值、IP 判斷點、session 管理、CLI 救援；設計決策章
- [`backend/12-settings.md`](../architecture/backend/12-settings.md)：`baseline` 合併與 API 的新欄位
- [`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §6、§13：底線的 MFA 要求、平台政策的生效值
- [`backend/04-auth.md`](../architecture/backend/04-auth.md) §2：平台 session 的時效與上限
- [`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8、[`iam/05-bootstrap.md`](../architecture/iam/05-bootstrap.md) §7（CLI 救援）
- [`apps/platform/README.md`](../../apps/platform/README.md) 的頁面清單

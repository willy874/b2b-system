# MFA（多因素驗證）：可擴充的驗證方式

- 優先度：P3
- 狀態：規劃中（開放問題與執行方式都已定案，§14.0；等使用者下令開工，開工時填 branch `feat/mfa`）
- 依賴：—
- 相關：[`architecture/04-sso.md`](../architecture/04-sso.md) §12.2 D15（MFA 預留）、§3.2、§3.5；[`backend/04-auth.md`](../architecture/backend/04-auth.md) §3（登入、鎖定、漸進延遲）、§8.2（直接登入）；
  [`05-tenancy.md`](../architecture/05-tenancy.md) §5.1、§5.2、§11（平台層開關與 feature flag，本功能的開關照它做）；[`backend/11-mail.md`](../architecture/backend/11-mail.md) §4（token 在寄出當下簽發）；
  [`backend/12-settings.md`](../architecture/backend/12-settings.md)；[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §6（註冊表）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

管理員帳號能改權限、平台管理者能建立與停用租戶，只靠密碼風險偏高。

登入已經改成 OIDC：backstage 沒有登入頁，所有人都在 apps/platform 的登入互動（`/interaction/:uid`）輸入密碼或選外部 IdP，
api 端由 `SsoInteractionController` → `SsoService.login` 驗證之後呼叫 `OidcProviderService.finishInteraction`（[`04-sso.md`](../architecture/04-sso.md) §3.2）。
[`04-sso.md`](../architecture/04-sso.md) §12.2 D15 已預留：**MFA 是登入互動裡的第二步**，插在密碼通過之後、`finishInteraction` 之前，不改協定、不新增 token 類型。

驗證方式會越來越多（這一版 TOTP 與 Email，之後可能有 WebAuthn／Passkey、簡訊、推播核准）。若每加一種就改登入流程、資料表、管理頁與平台開關，
成本與出錯面都會線性成長。所以這一版的重點不是兩種方式本身，而是 **一個共同的抽象**：

- 後端：每種方式是一個實作 `MfaMethod` 介面的模組，在 `onModuleInit` 向 `MfaMethodRegistry` 登記（與審批 handler、`SettingService.register`、標籤的資源類型同一個模式）。
  登入互動、管理端點、資料表、稽核、限流都只認介面，不認具體方式。
- 平台開關：每種方式像 feature flag 一樣有「全平台 ＋ 租戶」兩級覆寫，判斷規則與 `resolveFeatureFlag` 相同（[`05-tenancy.md`](../architecture/05-tenancy.md) §5.2）。
- 前端：每種方式的設定與驗證 UI 登記進 `web-core` 的註冊表（[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §6），登入互動與帳號設定頁依伺服器回傳的方式 id 取用。

### 現況

| | 租戶的使用者 | 平台管理者 |
| --- | --- | --- |
| 帳號表 | 租戶 DB 的 `users`，`mfa_enabled` 已預留（`db/schema/users.ts`）但沒有程式讀它 | 平台 DB 的 `platform_admins`，沒有 MFA 欄位 |
| 鎖定 | 門檻是租戶的系統設定（`auth.loginMaxAttempts`、`auth.loginLockoutSeconds`）；只寫 `locked_until` | 門檻在 env；同樣只寫 `locked_until` |
| 漸進延遲 | `LoginThrottle`（租戶 × email × IP 前綴），經 `RateLimitStore` | 同左（租戶 id 為 `platform`） |
| 其他登入路徑 | 外部 IdP（`amr=['ext']`，不受鎖定限制）；直接 `POST /auth/login`（production 預設關閉，`DIRECT_LOGIN_ENABLED`） | 無 |
| 機密加密 | `core/crypto` 的 `SecretBox`（AES-256-GCM，每種用途一把主金鑰：`IDP_SECRET_KEY`、`TENANT_SECRET_KEY`、`WEBHOOK_SECRET_KEY`） | 同左 |

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 共同抽象：`MfaMethod` 介面、`MfaMethodRegistry`、與方式無關的資料表、端點、稽核、限流 | WebAuthn／Passkey、簡訊、推播核准（介面預留，見 D3、D14） |
| 方式一：**TOTP**（驗證器 App，RFC 6238），每人最多 5 個裝置 | 「記住這台裝置 N 天」 |
| 方式二：**Email 驗證碼**（寄到帳號的 email，6 位數、10 分鐘） | 敏感操作的 step-up 驗證（介面的 `purpose` 預留） |
| 一次性備用碼（10 組、只存雜湊），屬於框架本身，不是可關閉的方式 | 外部 IdP 登入另外要求我們的 MFA（D9） |
| 登入互動的第二步（apps/platform 的互動頁 ＋ api 的互動端點），含「必須啟用但還沒設定」時的首次設定 | 使用者自訂接收驗證碼的 email（一律用帳號 email） |
| 平台層開關：每種方式「全平台 ＋ 租戶」兩級覆寫（照 feature flag） | |
| 租戶的 MFA 政策：允許哪些方式、全員必須或指定角色必須 | |
| 自助管理：backstage 與 apps/platform 的帳號設定頁（新增、移除、重新產生備用碼） | |
| 管理員重設他人的 MFA（寫稽核、撤銷該使用者的 session、寄通知信） | |
| 平台管理者必須啟用（production 強制） | |
| 直接 `POST /auth/login` 對已啟用 MFA 的帳號拒絕 | |

## 使用者故事

**作為租戶的 super-admin，我希望要求 admin 角色必須啟用 MFA，以便帳密外洩時對方仍登不進來。**

- **Given** 租戶的 MFA 政策把 `admin` 列為必須啟用，某位 admin 還沒設定任何驗證方式
- **When** 他在互動頁輸入正確的密碼
- **Then** 互動頁要求他先設定一種允許的方式（TOTP 或 Email），驗證成功後顯示備用碼，之後才完成登入

**作為使用者，我希望用手機的驗證器 App 或 Email 驗證碼完成第二步，手機遺失時能以備用碼登入。**

**作為平台管理者，我希望在寄信服務故障時立即對所有租戶關掉 Email 驗證，或只對某個租戶開放新的驗證方式試行。**

**作為開發者，我希望新增一種驗證方式（例如 WebAuthn）時只要寫一個實作 `MfaMethod` 的模組與一組前端元件，不必改登入流程、資料表與平台管理頁。**

---

## 設計

### 1. 組成

```
apps/api/src/
├── core/mfa/                               機制：不認識任何方式、不 import modules/
│   ├── mfa-method.ts                       ★ MfaMethod 介面、MfaMethodDefinition、MfaVerifyResult
│   ├── mfa-method.registry.ts              ★ MfaMethodRegistry：register / get / list（重複 id、格式錯誤 → 啟動失敗）
│   ├── mfa-toggle.ts                       resolveMfaMethod()：兩級覆寫的判斷（與 resolveFeatureFlag 同一個規則，抽成共用的 resolveToggle）
│   ├── totp.ts                             RFC 4226／6238 的 HOTP、TOTP（node:crypto，附 RFC 測試向量）
│   └── recovery-code.ts                    備用碼的產生、正規化、雜湊
├── modules/mfa/                            框架：流程、儲存、端點；只透過介面呼叫方式
│   ├── mfa.service.ts                      ★ 需求判斷、challenge／verify 的流程、備用碼、與鎖定和延遲的整合
│   ├── mfa-account.store.ts                MfaAccountStore 介面；tenant-mfa.store.ts、platform-mfa.store.ts 兩個實作（兩個 DB）
│   ├── mfa-policy.service.ts               租戶的 MFA 政策（mfa_policy）
│   ├── mfa-method-override.service.ts      全平台層覆寫（mfa_method_overrides）
│   ├── mfa-interaction.controller.ts       /oidc-interaction/:uid/mfa/*（登入互動）
│   ├── mfa-self.controller.ts              /auth/mfa/*（租戶使用者自助）、/platform/auth/mfa/*（平台管理者自助）
│   ├── mfa-admin.controller.ts             /users/:id/mfa、/platform/admins/:id/mfa（管理員檢視與重設）
│   ├── mfa-policy.controller.ts            /mfa/policy（租戶）
│   ├── platform-mfa-method.controller.ts   /platform/mfa-methods（平台）
│   └── mails/mfa-security-notice.mail.tsx  新增、移除、重設、備用碼使用時的安全通知信
├── modules/mfa-totp/                       方式：TOTP（實作 MfaMethod，onModuleInit 登記）
└── modules/mfa-email/                      方式：Email 驗證碼（實作 MfaMethod ＋ 自己的寄信工作）

packages/web-core/src/mfa/                  兩個前端共用
├── registry.ts                             ★ registerMfaMethod / useMfaMethods / requireMfaMethod
├── components/                             CodeInput、RecoveryCodesDialog、FactorList、MfaChallengeForm、MfaEnrollFlow
└── methods/totp/、methods/email/           內建方式的 UI（設定、驗證），由 app 的 plugin 登記
```

- `core/mfa` 只放介面、註冊表與純函式（TOTP、備用碼、開關判斷），所以 `modules/mfa` 與各方式的模組都可以依賴它，方式之間互不依賴。
- 方式的模組 **不直接查帳號表**：帳號、因子、challenge 的讀寫一律經 `modules/mfa` 傳入的 context（D5），同一份方式的實作同時服務租戶與平台。
- `modules/mfa` 不 import 任何方式的模組（[`coding-standards/07-layer-dependencies.md`](../coding-standards/07-layer-dependencies.md) §3.2）；`AppModule` 匯入方式的模組，它們在 `onModuleInit` 登記。

### 2. 共同抽象：`MfaMethod`

```ts
// core/mfa/mfa-method.ts
export type MfaRealm = 'tenant' | 'platform';
export type MfaPurpose = 'login' | 'enroll';            // 之後加 'stepUp'（敏感操作的再驗證）

export interface MfaMethodDefinition {
  /** camelCase，例：'totp'、'email'。上線後不改名：改名等於新方式，既有的因子與覆寫都會失效。 */
  id: string;
  /** 完成互動時寫進 amr（RFC 8176）：TOTP 'otp'；Email 'email'（非登記值，見 D12）。 */
  amr: string;
  /** 能用在哪些身分範圍（04-sso.md §1.1）。 */
  realms: readonly MfaRealm[];
  /** 每個帳號最多幾個這種因子：TOTP 5（多支手機）、Email 1（綁帳號 email）。 */
  maxFactorsPerAccount: number;
  /** 驗證前要不要先由伺服器發出 challenge：TOTP 'none'；Email 'server'（寄信）；WebAuthn 'server'（產生 challenge）。 */
  challenge: 'none' | 'server';
  /** 在哪裡設定：'anywhere'（backstage、apps/platform 都可以）；WebAuthn 之後是 'idp'（憑證綁 origin，只能在 apps/platform 註冊，D14）。 */
  enrollAt: 'anywhere' | 'idp';
  /** 平台兩級都沒有覆寫時的值（照 feature flag 的 defaultEnabled）。 */
  defaultEnabled: boolean;
  /** 安全強度（N2、D16）：'possession'（裝置）｜'inbox'（信箱，與重設密碼同一個管道）。這一版只顯示，政策還不依它限制。 */
  assurance: 'possession' | 'inbox';
}

export interface MfaMethod<TVerify = unknown> {
  readonly definition: MfaMethodDefinition;
  /** verify 的 payload（TOTP：{ code }；WebAuthn：assertion）。框架以它驗證後才呼叫 verify。 */
  readonly verifySchema: z.ZodType<TVerify>;

  /** 開始設定：產生機密與要給前端的資料（TOTP：otpauth URI；Email：遮蔽過的收件地址）。不寫 DB，由框架存成 pending 的因子。 */
  beginEnrollment(ctx: MfaAccountContext): Promise<MfaEnrollmentStart>;
  /** 發出 challenge（challenge = 'server' 的方式才實作）：Email 入列寄信工作。回傳要存的狀態與給前端的資料。 */
  startChallenge?(ctx: MfaAccountContext, factor: MfaFactor, purpose: MfaPurpose): Promise<MfaChallengeStart>;
  /** 驗證。只回傳結果，不寫 DB、不計數：失敗次數、鎖定、稽核、consumed 都由框架處理。 */
  verify(ctx: MfaAccountContext, factor: MfaFactor, challenge: MfaChallenge | null, payload: TVerify): Promise<MfaVerifyResult>;
  /** 列表上的顯示：{ label: 'iPhone', hint: 'w***@example.com' }。不得含機密。 */
  describe(factor: MfaFactor, account: MfaAccount): MfaFactorSummary;
}

export type MfaVerifyResult =
  | { ok: true; counter?: number }          // counter：TOTP 的時間步，框架存成 last_used_counter 防重放
  | { ok: false; reason: 'invalid' | 'expired' | 'replayed' };
```

- `MfaAccountContext` 由框架建立：`realm`、帳號（id、email、語系、租戶）、`secretBox`（`MFA_SECRET_KEY`）、`enqueue`（在租戶或平台脈絡入列工作）。方式不知道自己在哪個 DB。
- `MfaMethodRegistry.register(method)` 在啟動時檢查：id 格式（`/^[a-z][a-zA-Z0-9]*$/`）、重複、`realms` 非空、`recovery` 是保留字。
- **新增一種方式** ＝ 一個 `modules/mfa-<id>/` 模組 ＋ `AppModule` 匯入 ＋ 前端 `web-core/mfa/methods/<id>/` 登記 ＋ 兩個 app 的語系 ＋ apps/platform 的 `MFA_METHOD_LABEL_KEY`。
  資料表、端點、平台管理頁、政策頁都不改。

### 3. 資料模型

兩個身分範圍各一份，欄位相同（與 `refresh_tokens`／`platform_refresh_tokens`、`user_login_sources`／`platform_admin_login_sources` 相同的做法）：

| 租戶 DB | 平台 DB |
| --- | --- |
| `mfa_factors` | `platform_admin_mfa_factors` |
| `mfa_challenges` | `platform_admin_mfa_challenges` |
| `mfa_recovery_codes` | `platform_admin_mfa_recovery_codes` |
| `mfa_policy`（單列） | —（平台的政策在 env，D10） |
| — | `mfa_method_overrides`、`tenants.mfa_methods`（平台層開關，§5） |

```
mfa_factors
  id                 uuid pk
  user_id            uuid → users(id) ON DELETE CASCADE        （平台版是 admin_id）
  method             text            方式 id；不在註冊表的方式（程式移除後）讀取時忽略
  label              text            使用者取的名稱（TOTP：「iPhone」）；Email 為 null
  status             text            'pending' | 'active'；CHECK
  secret_encrypted   text null       SecretBox(MFA_SECRET_KEY) 的密文（TOTP 的 seed）；Email 為 null
  config             jsonb           方式自己的非機密設定（TOTP：digits、period、algorithm）
  last_used_counter  bigint null     TOTP 最後一次接受的時間步（防重放）
  last_used_at       timestamptz null
  interaction_uid    text null       在登入互動中設定時記下，互動作廢時一起清
  created_at, confirmed_at, updated_at
  INDEX (user_id) ; pending 的列 24 小時後由 auth.tokenCleanup 清除

mfa_challenges
  id, user_id, factor_id → mfa_factors ON DELETE CASCADE, purpose ('login' | 'enroll'),
  interaction_uid text null, state jsonb（方式自己的狀態；Email：code_hash、sent_at）,
  attempts int default 0, expires_at, consumed_at, created_at

mfa_recovery_codes
  id, user_id, code_hash text, used_at timestamptz null, created_at
  UNIQUE (user_id, code_hash)

mfa_policy（租戶 DB，一列，key = 'default'）
  require_all        boolean default false
  required_role_ids  uuid[] default '{}'     刪除的角色讀取時濾掉
  allowed_methods    text[] null             null = 平台開放的全部；否則與平台開放的取交集
  version, updated_at, updated_by
```

- **因子是硬刪除**，不進回收桶（憑證不應該能還原）。帳號永久刪除時 `ON DELETE CASCADE`。
- `users.mfa_enabled` 改成 **衍生欄位**：有任一 active 因子時為 true，由 `MfaService` 在新增、移除、重設的同一個交易維護；
  使用者列表顯示「MFA」欄並可篩選。`platform_admins` 加同名欄位。
- 機密：新的 `SecretBox` 用途 `MFA_SECRET_PURPOSE`（`MFA_SECRET_KEY`，32 bytes base64；production 必填，沒設時由 `JWT_SECRET` 以 HKDF 推導，只給開發用）。
  與 `IDP_SECRET_KEY` 分開：換其中一把不影響另一邊。**換 `MFA_SECRET_KEY` 會讓所有 TOTP 解不開**，換之前要有輪替計畫（D13）。
- Email 驗證碼只存 `HMAC-SHA256(MFA_SECRET_KEY 推導的子金鑰, challengeId ‖ code)`：6 位數的純 SHA-256 在 DB 外洩時一秒可窮舉。
- 備用碼 10 組、每組 10 個字元（Crockford base32，顯示成 `XXXXX-XXXXX`，約 50 bits），存 SHA-256；比對前去掉連字號、轉大寫。

### 4. 登入互動的第二步

```
apps/platform /interaction/:uid
  └─ POST …/:uid/login { email, password }
       api：verifyCredentials（不變：鎖定、狀態、只允許 SSO、稽核）
            → MfaService.requirementFor(account)（§4.1）
            ├─ none        → finishInteraction(amr ['pwd'])                      → { redirectTo }
            ├─ challenge   → oidc_payloads 存 MfaPending（10 分鐘）               → { next: 'mfa', factors: [...], recoveryAvailable }
            ├─ enroll      → 同上                                                → { next: 'mfaEnroll', methods: [...] }
            └─ unavailable → 寫稽核，回 403 AUTH_MFA_UNAVAILABLE（§4.1 第 4 步）
  └─ （challenge = 'server' 的因子）POST …/:uid/mfa/challenge { factorId }
       api：method.startChallenge → 存 mfa_challenges                            → { challengeId, hint, resendAvailableAt }
  └─ POST …/:uid/mfa/verify { factorId | 'recovery', challengeId?, payload }
       api：MfaPending 有效、因子屬於這個帳號且方式目前可用
            → method.verify（或備用碼比對）
            → 成功：消耗 challenge、更新 last_used_*、作廢 MfaPending
                    → finishInteraction(amr ['pwd', 'mfa', method.amr])           → { redirectTo }
            → 失敗：attempts + 1、併入鎖定與延遲（§4.2）                          → 400 AUTH_MFA_INVALID_CODE
  └─ （enroll）POST …/:uid/mfa/enroll { method } → { factorId, publicData }
               POST …/:uid/mfa/enroll/:factorId/confirm { challengeId?, payload, label? }
       api：驗證成功 → 因子改 active、產生備用碼                                 → { recoveryCodes, redirectTo }
            （頁面先顯示備用碼，使用者確認已保存後才頂層跳轉 redirectTo）
```

- **狀態存哪裡**：`oidc_payloads` 的新型別 `MfaPending`，id 是互動 uid（與 `ExternalLogin` 相同的儲存與 `oidc.cleanup` 清理）：
  `{ accountId, firstFactor: 'pwd', attempts, expiresAt }`。只有帶得到互動 cookie 的請求能用它，端點都在 `/oidc-interaction/:uid/` 底下。
- **不是 oidc-provider 的 `result.login`**：密碼通過時 **不** 呼叫 `finishInteraction`。若先寫 `result.login` 再要求第二步，握著 resume 網址的人可以跳過 MFA。
- **`SESSIONS_REVOKED` 一起作廢**（[`04-sso.md`](../architecture/04-sso.md) §3.5 D17）：帳號停用、改密碼、MFA 被重設時，刪除這些帳號的 `MfaPending` 與互動中 pending 的因子，
  握著互動的人要從密碼重新開始。
- **回應的形狀**：`POST …/:uid/login` 的回應改成 `SsoLoginResult = { redirectTo } | { next: 'mfa', … } | { next: 'mfaEnroll', … }`（OpenAPI 的 discriminated union）。
  舊版 apps/platform 只認 `redirectTo`，所以 api 與 apps/platform 要同一次部署（apps/platform 只拆前端，本來就一起部署）。
- 外部 IdP 登入（`amr=['ext']`）不經過第二步（D9）。

#### 4.1 需求判斷（`MfaService.requirementFor`）

```
可用的方式  = 註冊表中 realms 含此身分範圍
              ∧ 平台層生效為開（§5；平台管理者看 env PLATFORM_MFA_METHODS）
              ∧ 租戶政策允許（allowed_methods 為 null 或包含它）
可用的因子  = active 的因子中，方式屬於「可用的方式」
必須啟用    = 平台管理者：PLATFORM_MFA_REQUIRED
              租戶使用者：policy.require_all ∨ 持有 required_role_ids 中任一角色（含經由群組、巢狀群組持有，以權限解析的主體閉包判斷）

1. 有可用的因子（或有未用的備用碼且有任一 active 因子）        → challenge
2. 沒有任何 active 因子，必須啟用，且可用的方式非空              → enroll
3. 沒有任何 active 因子，不必啟用                                → none
4. 有 active 因子但方式全部被關掉、也沒有備用碼；或必須啟用但沒有可用的方式 → unavailable（403 AUTH_MFA_UNAVAILABLE）
```

- **已設定的人一律要第二步**，即使政策沒要求：使用者自己開的保護不因政策而失效。
- **第 4 步是 fail-closed**（D8）：方式被關掉時，不讓「只有那種因子」的人改去設定新的因子——那等於讓只知道密碼的人綁上自己的裝置。
  解法是備用碼，或請管理員重設（重設後下一次登入走第 2 步）。平台與租戶在關掉方式前都會先看到受影響的人數（§5、§6）。
- `unavailable` 寫 `auth.login.failure`（`metadata.reason: 'mfa_unavailable'`）。

#### 4.2 失敗、限流與鎖定

| 防線 | 做法 |
| --- | --- |
| 單一互動 | `MfaPending.attempts` 到 5 次就作廢，回 `AUTH_MFA_TOO_MANY_ATTEMPTS`，要從密碼重新開始 |
| 單一 challenge | Email 的 challenge 錯 5 次作廢，要重新寄；10 分鐘到期 |
| 鎖定 | 驗證碼錯誤與密碼錯誤 **共用** `failed_login_count`（租戶設定 `auth.loginMaxAttempts`；平台 env）；已知來源的錯誤照 [`04-auth.md`](../architecture/backend/04-auth.md) §3.4 不累計 |
| 漸進延遲 | 沿用 `LoginThrottle` 既有的鍵（租戶 × email × IP 前綴）：第二步已知道帳號的 email，與密碼錯誤累計在同一個計數 |
| 速率限制 | `verify`、`enroll/confirm`：`@RateLimit('auth')`；`challenge`（寄信）：`@RateLimit('authMail')`，另外同一因子 60 秒內不重寄（`429 RATE_LIMITED`，`details.retryAfterSeconds`，互動頁照樣倒數） |
| 重放 | TOTP 的時間步 ≤ `last_used_counter` 一律拒絕（`reason: 'replayed'`）：同一個碼在 30 秒內不能用兩次 |

- 錯誤碼可以區分（`AUTH_MFA_INVALID_CODE`、`AUTH_MFA_CHALLENGE_EXPIRED`）：第二步只有 **已經通過密碼** 的人看得到，與 [`04-auth.md`](../architecture/backend/04-auth.md) §3.2 的「通過密碼後才告知」一致。
- 鎖定中的帳號在第一步就回 `AUTH_INVALID_CREDENTIALS`，不會進到第二步。

### 5. 平台層開關（照 feature flag）

| 層級 | 儲存（平台 DB） | 誰改 | 端點（apps/platform） |
| --- | --- | --- | --- |
| 全平台 | `mfa_method_overrides`（`method`、`state`：`on` ｜ `off`、`updated_by`、`updated_at`；沒有列 = 不覆寫） | `mfaMethod:update` | `PUT /platform/mfa-methods/:id`（`{ state: 'default' \| 'on' \| 'off' }`） |
| 租戶 | `tenants.mfa_methods`（`jsonb`，`{ [id]: boolean }`，預設 `{}`） | `tenant:update` | `PATCH /platform/tenants/:id` 的 `mfaMethods`（完整覆寫表，與 `flags` 同） |

生效值與 `resolveFeatureFlag` **完全相同**（兩者改用 `core` 的共用函式 `resolveToggle`）：

```
全平台 off   → 關（緊急開關：例如寄信服務故障時關掉 email，蓋過租戶層）
租戶層有值   → 用租戶層（先對某個租戶開放新方式試行）
全平台 on    → 開
都沒有       → definition.defaultEnabled（TOTP、Email 都是 true）
```

- `GET /platform/mfa-methods`（`mfaMethod:read`）：註冊表裡的方式、全平台狀態、「覆寫成開／關的租戶數」、各方式已設定的因子數（跨租戶加總由背景工作每日統計，不即時查每個租戶 DB）。
- 租戶覆寫隨租戶登記載入 `TenantContext.mfaMethods`（`TenantDirectory`），變更時 `invalidate()` 並廣播，與 `flags` 相同；
  全平台層快取在 `MfaMethodOverrideService`，**接上 `BroadcastService`**（不要重蹈 `FeatureFlagService` 只靠 TTL 的覆轍，[`multi-instance.md`](./multi-instance.md)）。
- 寫入與平台稽核（`mfaMethod.update`；租戶的併入 `tenant.update` 的 `before`／`after`）同一個交易。
- **關掉前先看影響**：apps/platform 的切換對話框顯示「這個方式在這個租戶（或全平台）有幾個人只有這種因子、沒有備用碼」——這些人關掉後會 `AUTH_MFA_UNAVAILABLE`。
  照 [`05-tenancy.md`](../architecture/05-tenancy.md) §12.5 的做法：平台端點在那個租戶的脈絡裡查。
- 與 feature flag 的差別：方式是 **長期** 的，沒有 `removeBy`；不在註冊表的 id 讀取時忽略（程式移除方式後 DB 的殘留無害），`PUT` 回 `404 MFA_METHOD_NOT_FOUND`。
- 前端的 `/auth/profile` 不帶這份清單：登入互動與帳號設定頁各自向 api 取得「這個帳號可用的方式」。

### 6. 租戶的 MFA 政策

backstage 新的常駐 feature `security`（`/security/mfa`；不是可關閉的 feature——安全政策不應該因為平台關掉「系統設定」頁就看不到），
端點 `GET`／`PUT /mfa/policy`（`mfaPolicy:read`／`mfaPolicy:update`）：

| 欄位 | 畫面 | 驗證 |
| --- | --- | --- |
| `allowedMethods` | 平台開放的方式各一個勾選框（平台關掉的顯示為停用並註明「平台未開放」） | 至少一個，或 `null`（全部） |
| `requireAll` | 「所有人都必須啟用」 | 要求時允許的方式不能是空的 |
| `requiredRoleIds` | 角色多選（列出系統角色與自訂角色） | 角色存在；同上 |

- 必帶 `version`（樂觀鎖，`409 MFA_POLICY_VERSION_CONFLICT`）；稽核 `mfaPolicy.update`（`before`／`after`、`severity: high`）。
- **收緊立即生效、但不踢人**：已登入的人下一次登入才被要求設定；頁面上顯示「目前不符合政策的人數」（必須啟用卻沒有因子），可以點進使用者列表（`mfa=false` ＋ 角色篩選）。
- 從允許清單拿掉某種方式時與 §5 一樣先顯示受影響的人數。
- 權限 `mfaPolicy:update` 預設只給 super-admin：放寬 MFA 等於削弱所有人的保護，比一般的 `system:update` 敏感（D11）。
- 讀政策不做快取：只有登入互動、政策頁與「不符合政策的人數」會讀，一次查詢。

### 7. 自助管理（帳號設定）

| 端點（租戶：`/auth/mfa`；平台：`/platform/auth/mfa`） | 宣告 | 說明 |
| --- | --- | --- |
| `GET …` | `@Authenticated` | 我的因子（`describe` 的結果、最後使用時間）、剩餘備用碼數、可用的方式、是否必須啟用 |
| `POST …/factors { method }` | `@Authenticated` | 開始設定 → `{ factorId, publicData }`；Email 會同時寄出驗證碼。超過 `maxFactorsPerAccount` 回 `409 MFA_FACTOR_LIMIT_REACHED` |
| `POST …/factors/:id/challenge` | `@Authenticated` | 重寄（Email） |
| `POST …/factors/:id/confirm { payload, label? }` | `@Authenticated` | 驗證成功 → active；**第一個因子** 同時產生備用碼並回傳（只出現這一次） |
| `DELETE …/factors/:id { password }` | `@Authenticated` | 移除。必須啟用時不能移除最後一個可用的因子（`409 MFA_LAST_FACTOR`）；全部移除時備用碼一起刪 |
| `POST …/recovery-codes { password }` | `@Authenticated` | 重新產生，舊的全部作廢 |

- **敏感動作要再輸入密碼**（移除、重新產生備用碼）：只偷到 access token（5 分鐘）的人不能拆掉保護。之後有 step-up（`purpose: 'stepUp'`）時改成「密碼或 MFA」。
- **不撤銷其他 session**（舊開放問題 5）：新增與移除因子都不遞增 `token_version`；懷疑被盜用時用既有的變更密碼（會結束所有 session）。
- 每個動作寄 **安全通知信**（`mfa.securityNoticeMail`，工作資料只有 `{ accountId, event }`）：新增、移除、重新產生備用碼、**以備用碼登入**、被管理員重設。
  只偷到密碼的人在「必須啟用卻還沒設定」的帳號綁上自己的裝置時，本人會收到信。
- 畫面：backstage 的 `/profile` 加「安全性」分頁；apps/platform 的 `/profile` 同一組元件（`web-core/mfa`）。
- `enrollAt: 'idp'` 的方式（之後的 WebAuthn）在 backstage 只顯示「到帳號中心設定」的連結（D14）。

### 8. 管理員檢視與重設

| 端點 | 權限 | 說明 |
| --- | --- | --- |
| `GET /users/:id/mfa` | `user:read` | 因子的方式、名稱、設定與最後使用時間；不含機密與 email hint 以外的資訊 |
| `POST /users/:id/mfa/reset` | `user:update` | 刪除所有因子與備用碼、`token_version + 1`（結束所有 session，發 `SESSIONS_REVOKED`）、寄通知信；稽核 `user.mfa.reset`（`severity: high`） |
| `GET`／`POST /platform/admins/:id/mfa`、`…/reset` | `platformAdmin:read`／`platformAdmin:update` | 同上；不能重設自己（`AUTHZ_SELF_MODIFY`，與其他自我修改相同） |

- **反提權**：目標持有 super-admin（含經由群組）時，操作者也必須持有 super-admin（與服務帳號的規則相同，[`04-auth.md`](../architecture/backend/04-auth.md) §8.2）。
  否則 admin 可以拆掉 super-admin 的 MFA，再配合外洩的密碼登入。
- 使用者列表加「MFA」欄（`users.mfa_enabled`）與篩選；使用者詳情加「驗證方式」區塊與「重設 MFA」按鈕。
- 災難復原：`cli:reset-super-admin` 加 `--reset-mfa`（唯一的 super-admin 弄丟手機又沒有備用碼時）。

### 9. 兩種方式

#### 9.1 TOTP（`modules/mfa-totp`）

| 項目 | 值 |
| --- | --- |
| 演算法 | RFC 6238：HMAC-SHA1、6 位數、30 秒（各家驗證器 App 都支援的組合；SHA-256 在部分 App 會算錯） |
| seed | 20 bytes 隨機，base32；`SecretBox` 加密存 `secret_encrypted` |
| 容許誤差 | 前後各 1 個時間步 |
| 設定 | `beginEnrollment` 回 `otpauth://totp/<issuer>:<email>?secret=…&issuer=…`；issuer 是租戶名稱（平台管理者是「B2B Platform」）。前端以 `qrcode` 產生 QR code，並提供「無法掃描」時的手動輸入金鑰 |
| 重放 | 回傳 `counter`，框架存 `last_used_counter` |
| 實作 | `core/mfa/totp.ts` 自己實作（node:crypto 約 40 行，附 RFC 4226／6238 的測試向量），不加依賴 |

`otpauth` URI 含 seed：只出現在設定的回應裡，不寫日誌（`core/logger/redact.ts` 加回應欄位的遮蔽）、不進稽核。

#### 9.2 Email 驗證碼（`modules/mfa-email`）

| 項目 | 值 |
| --- | --- |
| 收件地址 | 帳號目前的 email（不另存）；`describe` 顯示 `w***@example.com` |
| 驗證碼 | 6 位數，`crypto.randomInt`；10 分鐘；一個 challenge 最多錯 5 次 |
| 寄送 | `startChallenge` 寫 challenge（還沒有碼）並在交易內入列 `mfa.emailCodeMail { challengeId }`。**碼在寄出當下由工作產生**、寫入雜湊後寄出（[`11-mail.md`](../architecture/backend/11-mail.md) §4 的規則：工作資料不含碼）；重試會換新的碼 |
| 寄送延遲 | 每種工作本來就是自己的佇列，不必優先度（`JobQueue` 也沒有 `priority`）；但租戶的 `job.maxConcurrency` 是所有工作合計，公告大量寄信時驗證碼信會被放回佇列。所以 `mfa.emailCodeMail` 的 `JobType` 宣告 **不受租戶同時執行數限制**（`core/jobs` 加這個選項）。登入頁提示「信件可能需要一分鐘」並提供重寄 |
| 設定 | 開始設定時就寄一封；輸入正確才算設定完成（確認收得到） |
| 平台管理者 | 以平台脈絡寄出（與 `platformAdmin.accountMail` 相同）；預設不開放（D10） |

**已知的弱點**（寫進正式文件）：Email 與「忘記密碼」走同一個信箱。信箱被入侵的人可以重設密碼、也收得到驗證碼，所以 Email 擋得住
**密碼外洩、撞庫**，擋不住 **信箱被入侵**。要擋後者的帳號應該用 TOTP；這一版的政策不限制「必須啟用的角色不能只用 Email」（N2、D16）。

### 10. 直接登入與其他路徑

- 直接 `POST /auth/login`（[`04-auth.md`](../architecture/backend/04-auth.md) §8.2）：帳號有 active 因子、或必須啟用時回 `403 AUTH_MFA_REQUIRED`。腳本改用 API token。
- API token、服務帳號：不受影響（token 本身就是憑證；服務帳號沒有密碼登入）。
- 帳號流程（啟用、重設密碼）：不經過 MFA；完成後回到登入，下一次登入照常要求第二步。重設密碼 **不清除** 因子。

### 11. 前端

**註冊表**（`@b2b-system/web-core/mfa`，照 [`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §6 的共同規則：重複註冊丟例外、讀取 miss 丟例外、React 端訂閱）：

```ts
registerMfaMethod({
  id: 'totp',
  labelKey: 'mfa.method.totp.label',
  descriptionKey: 'mfa.method.totp.description',
  icon: 'smartphone',
  Enroll: lazy(() => import('./TotpEnroll')),       // 顯示 QR code、手動金鑰、輸入第一個碼
  Challenge: lazy(() => import('./TotpChallenge')), // 輸入 6 位數
});
```

- 內建的 TOTP、Email 放 `web-core/mfa/methods/`，由兩個 app 的 `app/plugin.ts` 登記（apps/platform 的登入互動、兩個 app 的帳號設定都要用）。
- 伺服器回傳註冊表裡沒有的方式 id（例：api 先部署了新方式）時，該因子顯示為「這個版本不支援」、不可選，不讓畫面壞掉。
- apps/platform `features/login` 的互動頁：密碼步驟 → 依 `next` 切到 `MfaChallengeForm`（選因子、輸入碼、「改用備用碼」、重寄倒數沿用 `useCountdown`）或 `MfaEnrollFlow`（選方式 → 方式的 `Enroll` → `RecoveryCodesDialog`）。
- 備用碼對話框：顯示、複製、下載 `.txt`；要勾「我已保存」才能關。
- backstage：`/profile` 的「安全性」分頁、`features/user` 的 MFA 欄與重設、`features/security`（租戶的安全政策頁，分頁式容器：MFA 是第一個分頁 `/security/mfa`，[`tenant-security-policy.md`](./tenant-security-policy.md) 之後加自己的分頁）。apps/platform：`/profile`、`/mfa-method`（平台開關頁）、租戶詳情加 `?tab=mfa`。
- 權限：`features/security/permission.ts` 註冊 `/security/mfa` 的 page key（`mfaPolicy:read`）。

### 12. 權限、錯誤碼、稽核、指標

**權限**（同步 `docs/architecture/iam/02-permission-catalog.md`、`db/seeds/permissions.ts`、前端 `permission.ts`、兩個語系檔）：

| 鍵 | 範圍 | 預設持有 |
| --- | --- | --- |
| `mfaPolicy:read` | 租戶 | super-admin、admin、auditor |
| `mfaPolicy:update` | 租戶 | super-admin |
| `mfaMethod:read` | 平台 | 所有平台角色 |
| `mfaMethod:update` | 平台 | 平台 super-admin |

**錯誤碼**（`packages/error-codes` ＋ web-core 的 `ERROR_MESSAGE_KEY` 與語系；apps/platform 也要翻譯）：
`AUTH_MFA_REQUIRED`、`AUTH_MFA_INVALID_CODE`、`AUTH_MFA_CHALLENGE_EXPIRED`、`AUTH_MFA_TOO_MANY_ATTEMPTS`、`AUTH_MFA_UNAVAILABLE`、`AUTH_MFA_PENDING_INVALID`（互動的第二步已作廢）、
`MFA_METHOD_NOT_FOUND`、`MFA_METHOD_DISABLED`、`MFA_FACTOR_NOT_FOUND`、`MFA_FACTOR_LIMIT_REACHED`、`MFA_LAST_FACTOR`、`MFA_POLICY_VERSION_CONFLICT`。

**稽核**：

| 動作 | 時機 | metadata |
| --- | --- | --- |
| `auth.login.success` | 既有；加上 `amr`、`mfaMethod` | |
| `auth.login.failure` | 第二步失敗、`unavailable` | `step: 'mfa'`、`method`、`reason` |
| `mfa.factor.add`／`mfa.factor.remove` | 自助 | `method`、`factorId`、`duringLogin` |
| `mfa.recoveryCodes.regenerate`、`mfa.recoveryCode.use` | | `remaining` |
| `user.mfa.reset` | 管理員重設 | `severity: high` |
| `mfaPolicy.update` | 政策 | `before`／`after`，`severity: high` |
| 平台：`platformAdmin.mfa.*`、`mfaMethod.update` | | |

**指標**（`core/metrics/instruments.ts`，[`08-monitoring.md`](../architecture/08-monitoring.md) §2.4；標籤不帶租戶）：
`mfa_verifications_total{method, purpose, result}`、`mfa_challenges_sent_total{method}`、`mfa_email_delivery_seconds`（入列到寄出）。
Grafana 告警：Email 驗證碼寄送延遲的 p95 超過 60 秒（平台管理者據此決定要不要暫時全平台關掉 Email）。

### 13. 設定與部署

| 變數 | 用途 | production |
| --- | --- | --- |
| `MFA_SECRET_KEY` | 加密 TOTP seed、Email 驗證碼的 HMAC 金鑰（32 bytes，base64） | 必填（同 `IDP_SECRET_KEY` 的檢查） |
| `PLATFORM_MFA_REQUIRED` | 平台管理者必須啟用 | 預設 `true`；`NODE_ENV=production` 設成 `false` 會啟動失敗。開發環境預設 `false` |
| `PLATFORM_MFA_METHODS` | 平台管理者可用的方式（逗號分隔） | 預設 `totp`；不能是空的、不能含註冊表沒有的 id |

- 目前沒有正式環境（2026-10-07），不需要上線公告或資料遷移；開發環境的平台管理者在 `PLATFORM_MFA_REQUIRED=true` 時下一次登入走「首次設定」。
- 開發與 E2E：`db:seed:dev`／`db:seed:e2e` 的帳號不設因子、政策不要求；E2E 的 MFA 測試以 fixture 直接寫入已知 seed 的 TOTP 因子，測試輔助用 `core/mfa/totp.ts` 算碼；Email 走 Mailpit。

### 14. 實作計畫

#### 14.0 執行方式（2026-10-07 定案）

| # | 項目 | 決定 |
| --- | --- | --- |
| 1 | 開工時機 | 等使用者下令 |
| 2 | 中途停點 | 不停：M1 → M2 → M3 → 測試一路做完，最後一次回報 |
| 3 | 與 [`tenant-security-policy.md`](./tenant-security-policy.md) 的設定頁 | 合成一頁：`features/security` 是分頁式容器，MFA 是第一個分頁 |
| 4 | 新的前端依賴 | 可以加 `qrcode`（只在設定元件 lazy 載入） |
| 5 | 正式環境 | 沒有；資料、設定、相容性都可以任意修改，不需要上線公告與回滾計畫 |
| 6 | 驗證器 App 的 issuer | 租戶用租戶名稱、平台管理者用「B2B Platform」；之後 [`tenant-branding.md`](./tenant-branding.md) 定了產品名稱再改 |
| 7 | 驗證 | 實作期間不做瀏覽器驗證；**三個階段全部完成後** 才統一設計新的測試項目（單元、E2E，§14.5） |

#### 14.1 分支與階段

- branch：`feat/mfa`，worktree `../b2b-system-mfa`（開工時把本檔標頭與 [`README.md`](./README.md) §1 的狀態改成「實作中」）。
- 三個階段在同一個 branch 依序做，每階段結束 commit 一次；**全部完成、§14.5 的測試通過後才合併 `main` 一次**（不 push，等使用者指示）。
- 每階段結束都跑：`pnpm typecheck`、`pnpm lint`、`pnpm test`（既有的測試不能壞）；改到 controller／DTO／權限鍵時重新產生 openapi 與 SDK（[`CLAUDE.md`](../../CLAUDE.md)「常用指令」）。
  新功能的測試不在各階段寫，集中在 §14.5。
- migration 編號以開工時的 `main` 為準（目前租戶到 `0040`、平台到 `0016`）；下表以「下一號」表示。

| 階段 | 一句話 | 租戶 migration | 平台 migration |
| --- | --- | --- | --- |
| M1 框架 ＋ TOTP | 使用者可以自行啟用 TOTP，登入多一步 | 下一號：`mfa_factors`、`mfa_challenges`、`mfa_recovery_codes` | 下一號：三張 `platform_admin_mfa_*`、`platform_admins.mfa_enabled` |
| M2 Email | 第二種方式；**不得有 migration、不得改 `modules/mfa` 的流程** | — | — |
| M3 政策與開關 | 平台兩級開關、租戶政策、必須啟用、平台管理者強制 | 下一號：`mfa_policy` | 下一號：`mfa_method_overrides`、`tenants.mfa_methods` |

M2 排在政策之前：用第二種方式驗證 M1 的介面，介面要改就在只有兩種方式時改。
M2 若發現非改 `modules/mfa` 不可，先修介面（記在 §14.7 的實作紀錄），再繼續。

#### 14.2 M1：框架 ＋ TOTP

**後端**

1. `core/mfa`：`mfa-method.ts`（介面與型別）、`mfa-method.registry.ts`、`totp.ts`（RFC 4226／6238）、`recovery-code.ts`；
   `core/crypto` 加 `MFA_SECRET_PURPOSE`，`env.schema` 加 `MFA_SECRET_KEY`（production 必填、拒絕低熵）。
2. 兩個 migration 與 Drizzle schema（§3）；`users.mfa_enabled` 從「預留」改成由 `MfaService` 維護。
3. `modules/mfa`：
   - `MfaAccountStore` 與租戶、平台兩個實作；
   - `MfaService`：`requirementFor`（M1 只有 §4.1 的第 1、3、4 步，政策固定為「不要求」）、challenge／verify 流程、備用碼、與 `failed_login_count` 和 `LoginThrottle` 的整合（§4.2）；
   - `oidc_payloads` 的 `MfaPending` 型別；`SESSIONS_REVOKED` 的處理加上作廢 `MfaPending` 與互動中 pending 的因子
     （`OidcPayloadRepository.destroySessionsOf` 目前只刪 `Session`、`Interaction` 兩種型別，要加上 `MfaPending`）；
   - 鎖定計數共用：`AuthService`、`PlatformAdminService` 的 `registerFailedAttempt` 目前是 private，改成公開方法（或抽到兩者共用的地方）讓 `MfaService` 呼叫；
   - 端點：互動（§4）、自助（§7，租戶與平台）、管理員檢視與重設（§8，含 super-admin 的反提權）；
   - `auth.tokenCleanup`／`auth.platformTokenCleanup` 加清理過期的 pending 因子與 challenge。
4. `SsoService.login` 回傳 `SsoLoginResult`（§4 的 union）；`AuthService.login`（直接登入）對有因子的帳號回 `AUTH_MFA_REQUIRED`。
5. `modules/mfa-totp`：實作 `MfaMethod`、`onModuleInit` 登記；`AppModule` 匯入。
6. `core/logger/redact.ts`：遮蔽回應中的 `otpauthUri`、`secret`、`recoveryCodes`。
7. 錯誤碼（M1 用到的）：`AUTH_MFA_REQUIRED`、`AUTH_MFA_INVALID_CODE`、`AUTH_MFA_TOO_MANY_ATTEMPTS`、`AUTH_MFA_UNAVAILABLE`、`AUTH_MFA_PENDING_INVALID`、
   `MFA_METHOD_NOT_FOUND`、`MFA_FACTOR_NOT_FOUND`、`MFA_FACTOR_LIMIT_REACHED`。
8. 稽核：§12 除了 `mfaPolicy.update`、`mfaMethod.update` 以外的動作；指標 `mfa_verifications_total`。
9. `cli:reset-super-admin --reset-mfa`。

**前端**

1. `packages/web-core/src/mfa/`：註冊表、`CodeInput`、`RecoveryCodesDialog`、`FactorList`、`MfaChallengeForm`、`MfaEnrollFlow`；`methods/totp/`（QR code 用 `qrcode`，lazy 載入）；
   共用字串進 web-core 的語系。
2. apps/platform：`app/plugin.ts` 登記 TOTP；`features/login` 的互動頁接上 `next`（`useInteractionLogin` 改成回傳 union）；`/profile` 加「安全性」區塊；
   `features/platform-admin` 詳情加「驗證方式」與重設。
3. backstage：`app/plugin.ts` 登記 TOTP；`/profile` 的「安全性」分頁；`features/user` 的「MFA」欄、篩選、詳情的「驗證方式」與「重設 MFA」。
4. `pnpm bundle:check`：`qrcode` 只在設定的元件裡 lazy 載入，不進主要 bundle。

**測試候選**（不在這個階段寫，§14.5 統一設計時參考）

| 層 | 內容 |
| --- | --- |
| 單元 | `core/mfa/__tests__/totp.spec.ts`（RFC 6238 附錄 B 的向量、前後一步的容許、時間步邊界）、`recovery-code.spec.ts`（正規化、雜湊）、`mfa-method.registry.spec.ts`（重複、格式、保留字） |
| api 整合 | `apps/api/test/mfa.spec.ts`：自助設定與確認、登入第二步（成功、錯誤碼、重放、互動 5 次作廢、併入鎖定、已知來源不累計）、備用碼（只能用一次、重新產生後舊的失效）、不能跳過第二步（只拿 resume 網址）、`SESSIONS_REVOKED` 作廢 `MfaPending`、直接登入拒絕、管理員重設（撤銷 session、super-admin 的反提權）、平台管理者同一套 |
| 前端 | web-core 的元件與註冊表（重複註冊、未知方式 id 的顯示）；apps/platform `Interaction` 頁的第二步；backstage 的使用者詳情（重設按鈕的三個權限案例） |
| E2E | `apps/e2e/tests/mfa.spec.ts`：設定 TOTP → 登出 → 以 TOTP 登入；以備用碼登入。fixture 寫入已知 seed 的因子 |

**文件**：本檔的 §14.7 實作紀錄；`04-sso.md` §3.2 先加「第二步」的段落與互動端點表。正式的 `backend/20-mfa.md` 在 M3 歸檔時寫。

#### 14.3 M2：Email 驗證碼

1. `modules/mfa-email`：實作 `MfaMethod`（`challenge: 'server'`）；寄信工作 `mfa.emailCodeMail`（碼在寄出當下產生、HMAC 寫入 challenge；`JobType` 宣告不受租戶 `job.maxConcurrency` 限制，§9.2）；範本 `mails/mfa-email-code.mail.tsx`（兩個語系）。
2. `modules/mfa`：安全通知信 `mfa.securityNoticeMail`（新增、移除、重新產生備用碼、以備用碼登入、被重設），M1 的動作補上入列。
3. `core/jobs`：`JobTypeOptions` 加「不受租戶同時執行數限制」的選項，`JobQueue` 檢查 `job.maxConcurrency` 時略過這種工作。
4. 錯誤碼：`AUTH_MFA_CHALLENGE_EXPIRED`；重寄的冷卻沿用 `RATE_LIMITED`。
5. 指標：`mfa_challenges_sent_total`、`mfa_email_delivery_seconds`；Grafana 告警「Email 驗證碼寄送 p95 > 60 秒」（`deploy/` 的規則與 `sh deploy/check-monitoring.sh`）。
6. 前端：`web-core/mfa/methods/email/`（遮蔽的地址、重寄倒數 `useCountdown`），兩個 app 登記。
7. 平台管理者：`PLATFORM_MFA_METHODS` 在 M3 才有，M2 的平台互動頁 **不** 列出 Email（定義的 `realms` 含 `platform`，但平台的可用清單先寫死只有 `totp`）。
8. 測試候選（§14.5 統一設計）：`apps/api/test/mfa-email.spec.ts`（challenge 錯 5 次作廢、到期、重寄換碼後舊碼失效、工作資料不含碼、寄信前帳號已停用則略過、公告大量寄信時驗證碼信不被延後）；E2E 以 Mailpit 取信完成登入。
9. **驗收的硬條件**：與 M1 結束時的 commit 相比，`apps/api/src/modules/mfa`、`apps/api/src/db` 只有通知信相關的增加，沒有流程或 schema 的改動（`core/jobs` 的選項是寄送延遲的修正，不算違反）。

#### 14.4 M3：政策與開關

**後端**

1. `core` 抽出 `resolveToggle`，`resolveFeatureFlag` 改用它（行為不變，既有測試要全過）。
2. 平台：`mfa_method_overrides`、`tenants.mfa_methods`；`TenantDirectory` 載入 `TenantContext.mfaMethods`；`MfaMethodOverrideService`（快取 ＋ `BroadcastService` 失效）；
   `GET /platform/mfa-methods`、`PUT /platform/mfa-methods/:id`；`PATCH /platform/tenants/:id` 加 `mfaMethods`；影響人數（在租戶脈絡裡查）；平台稽核。
3. 每日統計各方式的因子數（平台頁用），新的平台背景工作 `mfa.factorStats`。
4. 租戶：`mfa_policy`、`MfaPolicyService`、`GET`／`PUT /mfa/policy`（樂觀鎖、跨欄位檢查、影響人數與「不符合政策的人數」）。
5. `MfaService.requirementFor` 補上 §4.1 的「必須啟用」（含群組閉包）與第 2 步（首次設定）；互動的 `enroll` 端點。
6. `PLATFORM_MFA_REQUIRED`（production 強制 `true`）、`PLATFORM_MFA_METHODS`（預設 `totp`）；取代 M2 寫死的平台清單。
7. 權限：`mfaPolicy:read`／`update`、`mfaMethod:read`／`update`（目錄、seed、前端 `permission.ts`、語系，[`CLAUDE.md`](../../CLAUDE.md)「三處必須同步」）。
8. 錯誤碼：`MFA_METHOD_DISABLED`、`MFA_LAST_FACTOR`、`MFA_POLICY_VERSION_CONFLICT`。

**前端**

1. backstage：新的常駐 feature `features/security`（分頁式容器，第一個分頁 `/security/mfa`；之後 `tenant-security-policy` 的 IP 清單、閒置逾時加自己的分頁。順序 `locale.ts` → `routes/` → `permission.ts` → `navigation.ts` → `plugin.ts` → `hooks/` → `pages/`）。
2. apps/platform：`features/mfa-method`（`/mfa-method`）；租戶詳情 `?tab=mfa`；關閉前的影響人數確認對話框；`MFA_METHOD_LABEL_KEY` 與語系。
3. 互動頁的首次設定（`MfaEnrollFlow` 已在 M1 做好，這裡接上 `next: 'mfaEnroll'`）。

**測試候選**（不在這個階段寫，§14.5 統一設計時參考）

| 層 | 內容 |
| --- | --- |
| 單元 | `resolveToggle`（四種組合；feature flag 原有測試不改） |
| api 整合 | `mfa-policy.spec.ts`：政策的跨欄位檢查、樂觀鎖、群組持有角色也算必須、首次設定、收緊後已登入的人不被踢；`platform-mfa-method.spec.ts`：兩級覆寫、全平台 `off` 蓋過租戶、方式關掉後 `AUTH_MFA_UNAVAILABLE` 與備用碼的出路、廣播失效（`cross-process.spec.ts` 的做法）、`PLATFORM_MFA_REQUIRED` |
| 前端 | `features/security` 頁面的三個權限案例；apps/platform 的開關頁與影響人數對話框 |
| E2E | 政策要求 admin → admin 登入時被要求設定；平台關掉 Email 的租戶覆寫 → 登入頁不再列出 Email |

**歸檔**（§14.5 的測試通過後、合併 `main` 前完成，依 [`README.md`](./README.md) §3.3）：寫 `docs/architecture/backend/20-mfa.md`（設計決策整節搬過去）與「歸檔去向」列的其他文件，刪除本檔與 §1 那一列。

#### 14.5 測試設計與驗證（三個階段全部完成後）

1. 依 `testing` skill 盤點：§14.2～§14.4 的「測試候選」、§4.1 的需求判斷表、§4.2 的每一條防線、§12 的錯誤碼，對照實際做出來的程式碼，
   列出測試項目清單（寫在本檔 §14.7，歸檔時搬進正式文件的「測試」一節）。
2. **單元**：`core/mfa`（TOTP 的 RFC 向量、備用碼、註冊表、`resolveToggle`）、`MfaService.requirementFor` 的判斷表、web-core 的元件與註冊表、各頁面的權限案例。
3. **E2E**（`apps/e2e/tests/mfa.spec.ts`）：TOTP 設定與登入、備用碼登入、Email 驗證碼經 Mailpit 登入、政策要求後的首次設定、平台關掉方式後的 `AUTH_MFA_UNAVAILABLE` 與備用碼出路、平台管理者的強制設定。
   以 fixture 寫入已知 seed 的因子，測試輔助用 `core/mfa/totp.ts` 算碼。
4. api 整合測試（`apps/api/test/`）照 repo 慣例補上，涵蓋 E2E 不適合跑的安全邊界：跳過第二步、重放、鎖定與已知來源、`SESSIONS_REVOKED`、反提權、廣播失效。
5. 全部跑過：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:e2e`（與 dev 並行時換埠，見 repo 的 E2E 並行做法）、`pnpm bundle:check`。

#### 14.6 環境與相容

沒有正式環境（§14.0 #5），以下只是開發環境要做的事：

| 項目 | 處理 |
| --- | --- |
| api 與 apps/platform 的互動回應改成 union | 同一個 branch 一起改，不考慮新舊版並存 |
| `MFA_SECRET_KEY` | 加進 `.env.example`、`deploy/prod.env.example`；`deploy/smoke-test.sh` 的必填檢查 |
| `PLATFORM_MFA_REQUIRED` | production 預設 `true`、dev 預設 `false` |
| dev DB | 合併後 `db:migrate`；dev／E2E 的 seed 不建因子、政策不要求 |

#### 14.7 實作紀錄

（實作時發現提案要改的地方記在這裡，歸檔時搬進正式文件的「實作紀錄」。）

---

## 開放問題

### 舊的問題（已有結論）

1. WebAuthn／Passkey 要不要一起做？互動頁是同一個，但註冊流程與資料表不同。
   **結論**：這一版不做。介面已預留（`challenge: 'server'`、`enrollAt: 'idp'`、方式自己的 `state` 與 `config`），資料表不必改（D3、D14）。
2. 外部 IdP 登入要不要另外要求我們的 MFA？
   **結論**：不要求，信任外部 IdP（D9）。
3. 「特定角色必須啟用」放在角色欄位上，還是系統設定？
   **結論**：都不是；放在租戶的 `mfa_policy`（`required_role_ids`），與允許的方式、全員要求放在同一處，由專門的端點做跨欄位檢查（D7）。
4. MFA 的設定頁放 backstage 的帳號設定，還是 apps/platform？
   **結論**：租戶使用者在 backstage 的 `/profile`、平台管理者在 apps/platform 的 `/profile`，元件共用 `web-core/mfa`；必須綁 origin 的方式（WebAuthn）之後只能在 apps/platform 設定（D14）。
5. 啟用或停用 MFA 時，要不要撤銷其他裝置的 session？
   **結論**：自助的新增、移除不撤銷（會連目前的 session 一起登出，且有變更密碼可以做）；管理員重設一律撤銷（§7、§8）。

### 設計時新增的問題（已有結論，2026-10-07）

- **N1. 平台層的「租戶覆寫」是否需要？** 只做全平台開關比較簡單；做了才能「先對某個租戶開放新方式試行」。
  **結論**：做。全平台 ＋ 租戶兩級，規則與 feature flag 相同（§5、D4），在 M3 實作。
- **N2. 政策要不要能限制「必須啟用的角色不能只用 Email」？** Email 擋不住信箱被入侵（§9.2）。
  **結論**：這一版不做限制。方式定義保留 `assurance`（`possession`／`inbox`），`mfa_policy` 不加欄位、沒有畫面；要做時的流程見 D16。
- **N3. 平台管理者要不要開放 Email？** 平台管理者沒有自助的「忘記密碼」，Email 的弱點比較小；但平台權限大。
  **結論**：預設只有 TOTP；`PLATFORM_MFA_METHODS` 可以加上 `email`（D10）。

---

## 設計決策

### D 表

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **方式是登記進註冊表的模組**（`MfaMethod` 介面 ＋ `MfaMethodRegistry.register`，在 `onModuleInit`） | 與審批 handler、系統設定、標籤的資源類型相同的模式；`modules/mfa` 不必認識任何方式，新增方式不改框架 |
| D2 | **方式只做「產生、驗證」，不寫 DB、不計數** | 失敗次數、鎖定、重放的儲存、稽核、`consumed` 若由每種方式自己做，第三種方式一定會漏；集中在框架才能保證一致 |
| D3 | **與方式無關的資料表**（`mfa_factors` 的 `secret_encrypted` ＋ `config jsonb`；`mfa_challenges.state jsonb`），不是每種方式一張表 | 新方式不必 migration；WebAuthn 的公鑰與 counter 放得進 `config`／`last_used_counter` |
| D4 | **平台層開關照 feature flag 的兩級覆寫與判斷規則**，共用 `resolveToggle`；但沒有 `removeBy` | 平台管理者只要學一套規則；方式是長期功能，不是試行開關 |
| D5 | **方式不知道身分範圍**：帳號、因子、challenge 經 `MfaAccountStore`（租戶、平台兩個實作）讀寫 | 同一份 TOTP 實作同時服務兩個 DB；身分範圍的規則（[`04-sso.md`](../architecture/04-sso.md) §1.1）留在框架 |
| D6 | **第二步的狀態存 `oidc_payloads` 的 `MfaPending`，密碼通過時不寫 `result.login`** | 先寫 `result.login` 的話，握著 resume 網址就能跳過第二步；`oidc_payloads` 已有清理與 `SESSIONS_REVOKED` 的作廢路徑 |
| D7 | **租戶政策是專門的單列表 `mfa_policy` ＋ 專門的端點**，不放系統設定、不加角色欄位 | 系統設定只存純量、沒有跨欄位檢查（「要求啟用」與「允許的方式不可為空」要一起驗證）；放在系統設定也會被平台的 `systemSetting` 開關一起藏起來。角色欄位要動角色的表、版本歷史與管理頁，而且政策分散在每個角色上不好稽核 |
| D8 | **方式被關掉時 fail-closed**：只剩不可用的因子的人回 `AUTH_MFA_UNAVAILABLE`，不讓他改設定新的因子 | 改設定新的因子等於讓只知道密碼的人綁上自己的裝置；以備用碼與管理員重設作為出路，並在關掉前顯示影響人數 |
| D9 | **外部 IdP 登入不要求我們的 MFA** | 外部 IdP 已驗過本人，企業的 IdP 通常自己有 MFA；各家 `amr` 不一致，無法可靠判斷。代價：外部 IdP 沒開 MFA 的租戶，經外部 IdP 登入的人只有一個因子（寫進已知限制） |
| D10 | **平台管理者的政策在 env**（`PLATFORM_MFA_REQUIRED`、`PLATFORM_MFA_METHODS`），production 強制要求 | 平台管理者只有幾位、權限最大；不提供可以在執行期放寬的開關 |
| D11 | **政策的修改是獨立權限 `mfaPolicy:update`，預設只有 super-admin** | 放寬 MFA 會削弱所有人，比一般系統設定敏感；與 `system:update` 分開才能把系統設定交給 admin 而不交出安全政策 |
| D12 | **amr 寫 `['pwd', 'mfa', <方式的 amr>]`**；Email 用非登記值 `email` | RFC 8176 沒有 email 的值，用 `otp` 會讓稽核分不出強度不同的兩種方式；`amr` 目前只進稽核，不影響授權 |
| D13 | **TOTP seed 以獨立的 `MFA_SECRET_KEY` 加密**，金鑰輪替這一版不做（換金鑰 = 所有人重新設定） | 與其他用途的金鑰分開，外洩或輪替互不影響；`SecretBox` 之後加「多把金鑰、以前綴辨識」時一併支援輪替 |
| D14 | **`enrollAt: 'idp'` 預留給綁 origin 的方式** | WebAuthn 憑證綁 RP ID：在 backstage（租戶網域）註冊的 passkey 在 apps/platform 的登入互動用不了，所以那種方式只能在 apps/platform 設定 |
| D15 | **備用碼是框架的一部分，不是可關閉的方式** | 備用碼是所有方式失效時的出路（D8）；若可以被平台或租戶關掉，D8 的 fail-closed 就沒有出口 |
| D16 | **這一版不依強度限制方式**（N2）：只在方式定義保留 `assurance`。之後要做時，`mfa_policy` 加 `required_min_assurance`，必須啟用而只有較弱因子的人 **先以既有因子通過第二步，再補設定** 較強的因子（不是 fail-closed，也不是跳過驗證就讓他設定） | 先上線、觀察使用情形；保留欄位與流程的方向，之後不必改介面。先驗既有因子再補設定，才不會讓只知道密碼的人綁上自己的裝置 |

### 評估過的方案

| 方案 | 不選的理由 |
| --- | --- |
| 直接用 feature flag 的目錄與表（每種方式一個 flag） | flag 有 `removeBy`、到期測試失敗；方式要長期存在，語意不同。共用的是判斷規則（`resolveToggle`），不是表 |
| 方式各自一張表（`totp_factors`、`email_factors`） | 每加一種方式要 migration、要改列表與重設的查詢；違背「新增方式不改框架」 |
| 用 `otpauth`／`otplib` 套件 | TOTP 本身約 40 行，有 RFC 測試向量可驗證；少一個要追蹤安全更新的依賴 |
| 第二步做成 oidc-provider 的另一個 prompt（`prompt: 'mfa'`） | 要改 provider 的 policy 與互動的 resume 流程；`MfaPending` 只是在同一個互動裡多存一筆，改動小且與外部登入的 `ExternalLogin` 對稱 |
| Email 驗證碼在 HTTP 請求內同步寄出（不入列） | 違反 [`11-mail.md`](../architecture/backend/11-mail.md) §4「寄信一律入列」；SMTP 慢或失敗會讓登入請求卡住。以優先度與告警處理延遲 |
| 「必須啟用」的人在方式被關掉時改走首次設定 | 見 D8 |

## 歸檔去向

- `docs/architecture/backend/20-mfa.md`（新）：框架、介面、資料表、端點、兩種方式、設計決策（本節整節搬過去）
- `docs/architecture/04-sso.md` §3（登入互動的第二步）、§11 刪掉「MFA 預留、未實作」
- `docs/architecture/backend/04-auth.md` §3（第二步與鎖定、延遲的整合）、§8.2（直接登入拒絕）
- `docs/architecture/05-tenancy.md` §5.1（`tenants.mfa_methods`）
- `docs/architecture/frontend/` 新章節（`web-core/mfa` 註冊表與元件）、`apps/platform/README.md`
- `docs/architecture/iam/02-permission-catalog.md`（四個權限）、`docs/overview/01-overview.md` 的範圍表、`CLAUDE.md` 的文件索引

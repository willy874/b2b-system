# 後端 21 — MFA（多因素驗證）

登入時除了密碼，再驗一次「持有的東西」。目前有六種方式：WebAuthn（安全金鑰、通行金鑰）、驗證器 App（TOTP）、簡訊、Telegram、LINE、Email，另有備用碼。
重點不在方式本身，而是 **共同的抽象**：每種方式是一個實作 `MfaMethod` 的模組，登記進註冊表；登入互動、資料表、管理端點、平台開關與政策都只認介面。
需要外部服務的方式（簡訊供應商的金鑰、Bot token）由平台管理者填寫 **平台參數**，**必填的參數填齊之前方式不能開啟**（§5.1）。

> 程式碼：後端 `apps/api/src/core/mfa/`（介面、註冊表、平台參數的入口、TOTP、伺服器送出的驗證碼、備用碼）、`apps/api/src/modules/mfa/`（框架）、
> `apps/api/src/modules/mfa-totp/`、`mfa-email/`、`mfa-webauthn/`、`mfa-sms/`、`mfa-messaging/`（Telegram、LINE）（方式）、
> `apps/api/scripts/mock-messaging.ts`（開發與 E2E 用的模擬供應商）、`apps/api/src/modules/user/user-login.service.ts`（密碼登入的檢查與鎖定）；
> 前端 `packages/web-core/src/mfa/`（共用元件與方式的 UI）、apps/platform `features/login`（第二步）、`features/mfa-method`（平台開關與參數）、
> backstage `features/security`（政策）、兩個 app 的 `/profile`。
> 相關：[`../04-sso.md`](../04-sso.md) §3.2（登入互動的第二步）、[`04-auth.md`](04-auth.md) §3（鎖定與漸進延遲）、[`../05-tenancy.md`](../05-tenancy.md) §5（平台層開關）。

---

## 背景

管理員帳號能改權限、平台管理者能建立與停用租戶，只靠密碼風險偏高。

登入已經改成 OIDC：backstage 沒有登入頁，所有人都在 apps/platform 的登入互動（`/interaction/:uid`）輸入密碼或選外部 IdP，
api 端由 `SsoInteractionController` → `SsoService.login` 驗證之後呼叫 `OidcProviderService.finishInteraction`（[`04-sso.md`](../04-sso.md) §3.2）。
[`04-sso.md`](../04-sso.md) §12.2 D15 已預留：**MFA 是登入互動裡的第二步**，插在密碼通過之後、`finishInteraction` 之前，不改協定、不新增 token 類型。

驗證方式會越來越多（這一版 TOTP 與 Email，之後可能有 WebAuthn／Passkey、簡訊、推播核准）。若每加一種就改登入流程、資料表、管理頁與平台開關，
成本與出錯面都會線性成長。所以這一版的重點不是兩種方式本身，而是 **一個共同的抽象**：

- 後端：每種方式是一個實作 `MfaMethod` 介面的模組，在 `onModuleInit` 向 `MfaMethodRegistry` 登記（與審批 handler、`SettingService.register`、標籤的資源類型同一個模式）。
  登入互動、管理端點、資料表、稽核、限流都只認介面，不認具體方式。
- 平台開關：每種方式像 feature flag 一樣有「全平台 ＋ 租戶」兩級覆寫，判斷規則與 `resolveFeatureFlag` 相同（[`05-tenancy.md`](../05-tenancy.md) §5.2）。
- 前端：每種方式的設定與驗證 UI 登記進 `web-core` 的註冊表（[`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §6），登入互動與帳號設定頁依伺服器回傳的方式 id 取用。

### 導入前的狀況

| | 租戶的使用者 | 平台管理者 |
| --- | --- | --- |
| 帳號表 | 租戶 DB 的 `users`，`mfa_enabled` 已預留（`db/schema/users.ts`）但沒有程式讀它 | 平台 DB 的 `platform_admins`，沒有 MFA 欄位 |
| 鎖定 | 門檻是租戶的系統設定（`auth.loginMaxAttempts`、`auth.loginLockoutSeconds`）；只寫 `locked_until` | 門檻在 env；同樣只寫 `locked_until` |
| 漸進延遲 | `LoginThrottle`（租戶 × email × IP 前綴），經 `RateLimitStore` | 同左（租戶 id 為 `platform`） |
| 其他登入路徑 | 外部 IdP（`amr=['ext']`，不受鎖定限制）；直接 `POST /auth/login`（production 預設關閉，`DIRECT_LOGIN_ENABLED`） | 無 |
| 機密加密 | `core/crypto` 的 `SecretBox`（AES-256-GCM，每種用途一把主金鑰：`IDP_SECRET_KEY`、`TENANT_SECRET_KEY`、`WEBHOOK_SECRET_KEY`） | 同左 |

## 範圍

第一版（10-07）做了 TOTP、Email 與框架；第二版（10-09）加上 WebAuthn、簡訊、Telegram、LINE、平台參數與「重新登入並新增」（§15.4 M4）。

| 做 | 不做 |
| --- | --- |
| 共同抽象：`MfaMethod` 介面、`MfaMethodRegistry`、與方式無關的資料表、端點、稽核、限流 | 推播核准（需要自己的手機 App） |
| 方式三：**WebAuthn**（安全金鑰、通行金鑰，§9.3），只能在 apps/platform 的網域註冊；租戶的使用者經「重新登入並新增」（§7.1） | 依強度限制方式的政策（D16，`assurance` 已細分，政策還不依它限制） |
| 方式四：**簡訊驗證碼**（Twilio 或自訂的 HTTP 閘道，§9.4）；只送到平台允許的國碼 | 租戶自帶簡訊供應商或 Bot（參數只有平台一份，D18） |
| 方式五、六：**Telegram、LINE**（Bot 傳送驗證碼，§9.5）；設定時以綁定碼連結帳號，webhook 驗簽章 | 其他通訊軟體（照 §9.5 的 `MessagingChannel` 加一個實作即可） |
| **平台參數**（§5.1）：方式宣告需要的欄位，平台管理者填寫；檢查通過才儲存、必填填齊才能開啟 | |
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

---

## 1. 組成

```
apps/api/src/
├── core/mfa/                               機制：不認識任何方式、不 import modules/
│   ├── mfa-method.ts                       ★ MfaMethod 介面、MfaMethodDefinition、MfaAccountContext、MfaVerifyResult、參數的定義
│   ├── mfa-method.registry.ts              ★ MfaMethodRegistry：register / get / list（重複 id、格式錯誤、參數定義錯誤 → 啟動失敗）
│   ├── mfa-method-settings.ts              方式與租戶模組讀取平台參數的入口 MfaMethodSettings（框架在啟動時 bind 快取）、格式檢查
│   ├── mfa-challenge-delivery.ts           方式的背景工作讀寫 challenge 的入口（框架在啟動時 bind 實作）
│   ├── otp-code.ts                         伺服器送出的 6 位數碼：產生、HMAC、比對（簡訊、通訊軟體共用）
│   ├── mfa-secrets.ts                      MfaSecretService：MFA_SECRET_KEY 的加解密與 HMAC
│   ├── totp.ts                             RFC 4226／6238 的 HOTP、TOTP（node:crypto，附 RFC 測試向量）
│   └── recovery-code.ts                    備用碼的產生、正規化、雜湊
├── core/feature-flags/feature-flags.ts     resolveToggle()：兩級覆寫的判斷（feature flag 與 MFA 的方式共用）
├── modules/user/user-login.service.ts      密碼檢查、失敗計數與鎖定、「登入成功」的副作用（登入互動、直接登入、第二步共用）
├── modules/mfa/                            框架：流程、儲存、端點；只透過介面呼叫方式
│   ├── mfa.service.ts                      ★ 設定、驗證、備用碼、管理員重設；方式的背景工作的 deliverChallenge
│   ├── mfa-login.service.ts                ★ 登入互動的第二步：需求判斷（§4.1）、MfaPending、失敗與鎖定的整合
│   ├── mfa-availability.service.ts         誰能用哪些方式、誰必須啟用（平台開關 ∩ 政策；平台管理者看 env）
│   ├── mfa-notifier.ts                     安全通知信的工作（mfa.securityNoticeMail／mfa.platformSecurityNoticeMail）
│   ├── mfa-account.store.ts                MfaAccountStore 介面；tenant-mfa.store.ts、platform-mfa.store.ts 兩個實作（兩個 DB）
│   ├── mfa.repository.ts                   MfaRepository 介面；tenant-mfa.repository.ts、platform-mfa.repository.ts
│   ├── mfa-policy.service.ts               租戶的 MFA 政策（mfa_policy）、影響預覽
│   ├── mfa-method-override.service.ts      全平台層覆寫（mfa_method_overrides；快取 ＋ 廣播失效）
│   ├── mfa-method-settings.service.ts      平台參數（mfa_method_settings；加密、檢查、快取 ＋ 廣播失效，§5.1）
│   ├── platform-mfa-method.service.ts      平台開關頁、影響人數、每日統計（mfa.factorStats）
│   ├── mfa-cleanup.jobs.ts                 沒確認的因子、過期的 challenge（mfa.cleanup／mfa.platformCleanup）
│   ├── mfa-interaction.controller.ts       /oidc-interaction/:uid/mfa/*（登入互動）
│   ├── mfa-self.controller.ts              /auth/mfa/*（租戶使用者自助）、/platform/auth/mfa/*（平台管理者自助）
│   ├── mfa-admin.controller.ts             /users/:id/mfa、/platform/admins/:id/mfa（管理員檢視與重設）
│   ├── mfa-policy.controller.ts            /mfa/policy（租戶）
│   ├── platform-mfa-method.controller.ts   /platform/mfa-methods（平台）
│   └── mails/mfa-security-notice.mail.tsx  新增、移除、重設、備用碼使用時的安全通知信
├── modules/mfa-totp/                       方式：TOTP（實作 MfaMethod，onModuleInit 登記）
├── modules/mfa-email/                      方式：Email 驗證碼（實作 MfaMethod ＋ 自己的寄信工作）
├── modules/mfa-webauthn/                   方式：WebAuthn（@simplewebauthn/server，§9.3）
├── modules/mfa-sms/                        方式：簡訊（SmsGateway：Twilio、自訂閘道，§9.4）
└── modules/mfa-messaging/                  方式：Telegram、LINE（綁定表 mfa_channel_links、Bot 的 webhook，§9.5）

packages/web-core/src/mfa/                  兩個前端共用
├── registry.ts                             ★ registerMfaMethod / useMfaMethodUi / useMfaMethodUis / requireMfaMethod
├── components/                             CodeInput、RecoveryCodesDialog、FactorList、MfaChallengeForm、MfaEnrollFlow、
│                                           MfaSecuritySection（帳號設定）、MfaAccountStatusSection（管理員檢視）、PasswordConfirmDialog
└── methods/                                內建方式的 UI（設定、驗證），由 app 的 plugin 登記：totp、email、webauthn、sms、messaging（telegram、line）、shared
```

- `core/mfa` 只放介面、註冊表與純函式（TOTP、備用碼、開關判斷），所以 `modules/mfa` 與各方式的模組都可以依賴它，方式之間互不依賴。
- 方式的模組 **不直接查帳號表**：帳號、因子、challenge 的讀寫一律經 `modules/mfa` 傳入的 context（D5），同一份方式的實作同時服務租戶與平台。
- `modules/mfa` 不 import 任何方式的模組（[`coding-standards/07-layer-dependencies.md`](../../coding-standards/07-layer-dependencies.md) §3.2）；`AppModule` 匯入方式的模組，它們在 `onModuleInit` 登記。

## 2. 共同抽象：`MfaMethod`

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
  /** 設定時第一個 challenge 什麼時候發：'immediate'（預設，Email、簡訊、WebAuthn）｜'onRequest'（通訊軟體：先綁定帳號才知道送到哪裡）。 */
  enrollChallenge?: 'immediate' | 'onRequest';
  /** 安全強度（N2、D16）：'phishingResistant'（WebAuthn）＞'possession'（TOTP）＞'messaging'（簡訊、通訊軟體）／'inbox'（Email）。只顯示，政策還不依它限制。 */
  assurance: MfaAssurance;
  /** 需要的平台參數（§5.1）；有的話 defaultEnabled 必須是 false（登記時檢查）。 */
  settings?: { fields: MfaSettingField[] };
}

export interface MfaMethod<TVerify = unknown> {
  readonly definition: MfaMethodDefinition;
  /** verify 的 payload（TOTP：{ code }；WebAuthn：瀏覽器的回應）。框架以它驗證後才呼叫 verify。 */
  readonly verifySchema: z.ZodType<TVerify>;
  /** 開始設定時使用者要給的資料（簡訊：{ phone }）；框架驗證失敗回 VALIDATION_FAILED（fields.input.<key>）。 */
  readonly enrollSchema?: z.ZodType<TEnroll>;

  /** 開始設定：產生機密與要給前端的資料（TOTP：otpauth URI；Email：遮蔽過的收件地址）。不寫 DB，由框架存成 pending 的因子。 */
  beginEnrollment(ctx: MfaAccountContext, input: TEnroll | undefined): Promise<MfaEnrollmentStart>;
  /** 發出 challenge（challenge = 'server' 的方式才實作）：Email 入列寄信工作。回傳要存的狀態與給前端的資料。 */
  startChallenge?(ctx: MfaAccountContext, factor: MfaFactor, challenge: { id: string; purpose: MfaPurpose }): Promise<MfaChallengeStart>;
  /** 驗證。只回傳結果，不寫 DB、不計數：失敗次數、鎖定、稽核、consumed 都由框架處理。 */
  verify(ctx: MfaAccountContext, factor: MfaFactor, challenge: MfaChallenge | null, payload: TVerify): Promise<MfaVerifyResult>;
  /** 列表上的顯示：{ label: 'iPhone', hint: 'w***@example.com' }。不得含機密。 */
  describe(factor: MfaFactor, account: MfaAccount): MfaFactorSummary;
  /** 檢查平台參數（§5.1）：以金鑰呼叫供應商、登記 webhook；不通過就不儲存。derived 是要一起存的值（Bot 的名稱）。 */
  checkSettings?(values: MfaSettingValues): Promise<MfaSettingsCheck>;
  /** 能取代密碼的方式（WebAuthn；04-sso.md §3.6）：不知道帳號時的 challenge、從回應找因子與帳號。驗證仍走 verify。 */
  readonly passwordless?: MfaPasswordless<TVerify>;
}

export type MfaVerifyResult =
  | { ok: true; counter?: number; factorUpdate?: { secret?: string; config?: Record<string, unknown> } }
  | { ok: false; reason: 'invalid' | 'expired' | 'replayed' };
// counter：TOTP 的時間步、WebAuthn 的簽章計數，框架存成 last_used_counter 防重放
// factorUpdate：設定確認時寫回因子（WebAuthn 的公鑰、通訊軟體的收件對象；secret 由框架加密）
```

- `MfaAccountContext` 由框架建立：`realm`、帳號（id、email、語系、租戶）、`secrets`（`MFA_SECRET_KEY` 的加解密與 HMAC）、`enqueue`（租戶在框架的交易內走 outbox，平台在提交後送出）、
  `activeFactors(method?)`（帳號 active 的因子：WebAuthn 註冊時排除已註冊的憑證）。方式不知道自己在哪個 DB。
- `MfaChallengeStart.publicData`：只回給前端、不存 DB 的資料（WebAuthn 給瀏覽器 API 的 options）；`MfaChallengeInfo.publicData` 帶出去。
- 方式讀平台參數經 `MfaMethodSettings`（`core/mfa`）：同步讀取（快取在 `modules/mfa`），`require(id)` 在方式可用時一定有值。
- `challengeId` 由框架先產生再交給 `startChallenge`：方式可以把它放進自己入列的工作，與 challenge 寫在同一個交易。方式的背景工作要讀寫 challenge 時經 `MfaChallengeDelivery.deliver`（`core/mfa`），不直接查 DB、也不依賴 `modules/mfa`。
- `MfaMethodRegistry.register(method)` 在啟動時檢查：id 格式（`/^[a-z][a-zA-Z0-9]*$/`）、重複、`realms` 非空、`recovery` 是保留字。
- **新增一種方式** ＝ 一個 `modules/mfa-<id>/` 模組 ＋ `AppModule` 匯入 ＋ 前端 `web-core/mfa/methods/<id>/`（兩個 app 的 `app/plugin.ts` 登記）＋ web-core 語系的 `mfa.method.<id>.*`
  （需要參數時另有 `mfa.method.<id>.settings.<key>.label`／`.description`）。資料表、端點、平台管理頁（參數表單依 `settings` 產生）、政策頁都不改。
  這一版加的三個模組驗證了這一點：框架只多了上面列的介面欄位，`modules/mfa` 的流程沒有為了某一種方式寫分支。

## 3. 資料模型

兩個身分範圍各一份，欄位相同（與 `refresh_tokens`／`platform_refresh_tokens`、`user_login_sources`／`platform_admin_login_sources` 相同的做法）：

| 租戶 DB | 平台 DB |
| --- | --- |
| `mfa_factors` | `platform_admin_mfa_factors` |
| `mfa_challenges` | `platform_admin_mfa_challenges` |
| `mfa_recovery_codes` | `platform_admin_mfa_recovery_codes` |
| `mfa_policy`（單列） | —（平台的政策在 env，D10） |
| — | `mfa_method_overrides`、`tenants.mfa_methods`（平台層開關，§5）、`mfa_method_stats`（每日統計）、`mfa_method_settings`（平台參數，§5.1）、`mfa_channel_links`（通訊軟體的綁定，§9.5） |

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
  attempts int default 0, expires_at, resend_after（重寄冷卻）, consumed_at, created_at
  同一個因子只留最新的 challenge：重發時先消耗上一筆（舊的碼失效）

mfa_recovery_codes
  id, user_id, code_hash text, used_at timestamptz null, created_at
  UNIQUE (user_id, code_hash)

mfa_policy（租戶 DB，一列，key = 'default'）
  require_all        boolean default false
  required_role_ids  uuid[] default '{}'     刪除的角色讀取時濾掉
  allowed_methods    text[] null             null = 平台開放的全部；否則與平台開放的取交集
  version, updated_at, updated_by
```

```
mfa_method_settings（平台 DB，一個方式一列；平台 migration 0025）
  method            text pk
  values            jsonb      一般欄位
  secrets_encrypted text null  機密欄位合成一段 JSON，以 MFA_SECRET_KEY 加密
  version, updated_by, updated_at

mfa_channel_links（平台 DB；平台 migration 0025）
  id, channel ('telegram' | 'line'), code_hash text unique（綁定碼的 HMAC）, realm, tenant_id null, account_id,
  recipient_encrypted null（綁定後才有）, recipient_name null, linked_at null, expires_at（30 分鐘）, created_at
```

- **因子是硬刪除**，不進回收桶（憑證不應該能還原）。帳號永久刪除時 `ON DELETE CASCADE`。
- `users.mfa_enabled` 改成 **衍生欄位**：有任一 active 因子時為 true，由 `MfaService` 在新增、移除、重設的同一個交易維護；
  使用者列表顯示「MFA」欄並可篩選。`platform_admins` 加同名欄位。
- 機密：新的 `SecretBox` 用途 `MFA_SECRET_PURPOSE`（`MFA_SECRET_KEY`，32 bytes base64；production 必填，沒設時由 `JWT_SECRET` 以 HKDF 推導，只給開發用）。
  與 `IDP_SECRET_KEY` 分開：換其中一把不影響另一邊。**換 `MFA_SECRET_KEY` 會讓所有 TOTP 解不開**，換之前要有輪替計畫（D13）。
- Email 驗證碼只存 `HMAC-SHA256(MFA_SECRET_KEY 推導的子金鑰, challengeId ‖ code)`：6 位數的純 SHA-256 在 DB 外洩時一秒可窮舉。
- 新方式的因子欄位：WebAuthn 的公鑰、憑證 id、RP ID、transports 在 `config`（公鑰不是機密）、簽章計數在 `last_used_counter`；
  簡訊的號碼與通訊軟體的收件對象（chat id、LINE user id）在 `secret_encrypted`，`config` 只放遮蔽過的提示（`phoneMasked`、`recipientName`）。
- 備用碼 10 組、每組 10 個字元（Crockford base32，顯示成 `XXXXX-XXXXX`，約 50 bits），存 SHA-256；比對前去掉連字號、轉大寫。

## 4. 登入互動的第二步

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
  `{ accountId, firstFactor: 'pwd', next: 'mfa' | 'mfaEnroll', attempts }`（到期時間在列的 `expires_at`；失敗次數以 `jsonb_set` 原子遞增）。只有帶得到互動 cookie 的請求能用它，端點都在 `/oidc-interaction/:uid/` 底下。
- **不是 oidc-provider 的 `result.login`**：密碼通過時 **不** 呼叫 `finishInteraction`。若先寫 `result.login` 再要求第二步，握著 resume 網址的人可以跳過 MFA。
- **`SESSIONS_REVOKED` 一起作廢**（[`04-sso.md`](../04-sso.md) §3.5 D17）：帳號停用、改密碼、MFA 被重設時，刪除這些帳號的 `MfaPending` 與互動中 pending 的因子，
  握著互動的人要從密碼重新開始。
- **回應的形狀**：`POST …/:uid/login` 的回應改成 `SsoLoginResult = { redirectTo } | { next: 'mfa', … } | { next: 'mfaEnroll', … }`（OpenAPI 的 discriminated union）。
  舊版 apps/platform 只認 `redirectTo`，所以 api 與 apps/platform 要同一次部署（apps/platform 只拆前端，本來就一起部署）。
- 外部 IdP 登入（`amr=['ext']`）不經過第二步（D9）。
- 產品要求新增驗證方式時（backstage 的「新增安全金鑰」，authorize 帶 `mfa_enroll`），`…/mfa/verify` 成功後回傳設定的下一步而不是 resume 網址，設定可以略過（`…/mfa/enroll/skip`）；見 §7.1。

### 4.1 需求判斷（`MfaService.requirementFor`）

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

### 4.2 失敗、限流與鎖定

| 防線 | 做法 |
| --- | --- |
| 單一互動 | `MfaPending.attempts` 到 5 次就作廢，回 `AUTH_MFA_TOO_MANY_ATTEMPTS`，要從密碼重新開始 |
| 單一 challenge | Email 的 challenge 錯 5 次作廢，要重新寄；10 分鐘到期 |
| 鎖定 | 驗證碼錯誤與密碼錯誤 **共用** `failed_login_count`（租戶設定 `auth.loginMaxAttempts`；平台 env）；已知來源的錯誤照 [`04-auth.md`](04-auth.md) §3.4 不累計 |
| 漸進延遲 | 沿用 `LoginThrottle` 既有的鍵（租戶 × email × IP 前綴）：第二步已知道帳號的 email，與密碼錯誤累計在同一個計數 |
| 速率限制 | `verify`、`enroll/confirm`：`@RateLimit('auth')`；`challenge`（寄信）：`@RateLimit('authMail')`，另外同一因子 60 秒內不重寄（`429 RATE_LIMITED`，`details.retryAfterSeconds`，互動頁照樣倒數） |
| 重放 | TOTP 的時間步 ≤ `last_used_counter` 一律拒絕（`reason: 'replayed'`）：同一個碼在 30 秒內不能用兩次 |

- 錯誤碼可以區分（`AUTH_MFA_INVALID_CODE`、`AUTH_MFA_CHALLENGE_EXPIRED`）：第二步只有 **已經通過密碼** 的人看得到，與 [`04-auth.md`](04-auth.md) §3.2 的「通過密碼後才告知」一致。
- 鎖定中的帳號在第一步就回 `AUTH_INVALID_CREDENTIALS`，不會進到第二步。

## 5. 平台層開關（照 feature flag）

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

- `GET /platform/mfa-methods`（`mfaMethod:read`）：註冊表裡的方式、全平台狀態、「覆寫成開／關的租戶數」、各方式已設定的因子數（平台工作 `mfa.factorStats` 每日統計進 `mfa_method_stats`，不即時查每個租戶 DB）、平台管理者能不能用（`PLATFORM_MFA_METHODS`）。
- 租戶覆寫隨租戶登記載入 `TenantContext.mfaMethods`（`TenantDirectory`），變更時 `invalidate()` 並廣播，與 `flags` 相同；
  全平台層快取在 `MfaMethodOverrideService`，**接上 `BroadcastService`**（不要重蹈 `FeatureFlagService` 只靠 TTL 的覆轍，[`../01-system.md`](../01-system.md) §7）。
- 寫入與平台稽核（`mfaMethod.update`；租戶的併入 `tenant.update` 的 `before`／`after`）同一個交易。
- **關掉前先看影響**：apps/platform 的切換對話框顯示「這個方式在這個租戶（或全平台）有幾個人只有這種因子、沒有備用碼」——這些人關掉後會 `AUTH_MFA_UNAVAILABLE`。
  照 [`05-tenancy.md`](../05-tenancy.md) §12.5 的做法：`GET /platform/mfa-methods/:id/impact?tenantId=` 逐一進租戶（`Tenancy.run`）以
  「可以登入、每一個 active 因子都不在剩下的方式、沒有未用的備用碼」計數；進不去的租戶略過並回報數量。
- 與 feature flag 的差別：方式是 **長期** 的，沒有 `removeBy`；不在註冊表的 id 讀取時忽略（程式移除方式後 DB 的殘留無害），`PUT` 回 `404 MFA_METHOD_NOT_FOUND`。
- 前端的 `/auth/profile` 不帶這份清單：登入互動與帳號設定頁各自向 api 取得「這個帳號可用的方式」。

### 5.1 平台參數：填齊之前不能開啟

簡訊、通訊軟體、WebAuthn 需要外部服務的金鑰或網域設定。方式在定義裡宣告 `settings.fields`，平台管理者在 apps/platform 的開關頁按「參數」填寫：

| 欄位型別 | 存放 | API 回傳 |
| --- | --- | --- |
| `text`、`url`、`select` | `mfa_method_settings.values` | 值 |
| `secret`（Auth Token、Bot token、channel secret） | 合成一段 JSON，以 `MFA_SECRET_KEY` 加密成 `secrets_encrypted` | 只回傳有沒有設定（`secrets: { key: true }`）；送出時沒帶 = 沿用、空字串 = 清除 |

- **必填** 可以帶條件：`requiredWhen: { key: 'provider', equals: 'twilio' }`（選了 Twilio 才要 Account SID）。前端只顯示條件成立的欄位，送出時不帶隱藏的欄位。
- **儲存的檢查**（`PUT /platform/mfa-methods/:id/settings`）依序：欄位存在、必填與格式（`VALIDATION_FAILED`，`fields.<key>` 是原因代碼）→ 方式的 `checkSettings`
  （以金鑰呼叫供應商、向 Telegram／LINE 登記 webhook；不通過回 `400 MFA_METHOD_SETTINGS_CHECK_FAILED`，帶 `fields` 或整體的 `reason`）。全部通過才寫入，
  所以 **存得進去的參數一定是填齊、可以用的**。檢查時取得的值（Bot 的 username、LINE 官方帳號 ID）存進定義過的一般欄位。
- **樂觀鎖**：送出讀到的 `version`（還沒儲存過是 `null`），不符回 `409 MFA_METHOD_SETTINGS_VERSION_CONFLICT`。
- **開啟的前置條件**：參數沒有填齊（或解不開，例如換了 `MFA_SECRET_KEY`）的方式——
  - 全平台層：`PUT /platform/mfa-methods/:id` 結果會是開啟時回 `409 MFA_METHOD_NOT_CONFIGURED`；關閉、回到預設可以（需要參數的方式 `defaultEnabled` 必須是 `false`，登記時檢查）。
  - 租戶層：`PATCH /platform/tenants/:id` 的 `mfaMethods` 把它設成 `true` 時同樣回 409（`details.methods`）。
  - 可用方式的判斷（`MfaAvailability`）一律濾掉它：即使 `PLATFORM_MFA_METHODS` 列了，平台管理者也不能用。這是第二道防線。
  - 前端：開關頁標示「尚未設定參數」，「全平台開啟」與租戶的「開」不能選。
- **刪除參數**（`DELETE …/settings`）：方式還開著（全平台 `on`、有租戶覆寫成開、或平台管理者可用）時回 `409 MFA_METHOD_SETTINGS_IN_USE`——否則已設定的人登入時方式會突然消失。
- **快取**：全部載入記憶體（每次登入都要判斷），變更時本機重讀並以 `BroadcastService.channel('mfa_method_settings')` 通知其他程序，另有 `TENANT_CACHE_TTL` 兜底；
  方式以 `MfaMethodSettings`（`core/mfa`）同步讀取。某一列解不開只略過那一列（記錯誤日誌），該方式視為沒有設定。
- **稽核**：`mfaMethod.configure`（一般欄位的 `before`／`after`、`secretsChanged` 只列換了哪些機密的鍵，不記值；`severity: high`）、`mfaMethod.unconfigure`。

## 6. 租戶的 MFA 政策

backstage 新的常駐 feature `security`（系統設定的「安全性」分頁 `/system/security`，[`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §4.5；不是可關閉的 feature——安全政策不應該因為平台關掉「系統設定」的「一般」分頁就看不到），
端點 `GET`／`PUT /mfa/policy`（`mfaPolicy:read`／`mfaPolicy:update`）：

| 欄位 | 畫面 | 驗證 |
| --- | --- | --- |
| `allowedMethods` | 平台開放的方式各一個勾選框；平台關掉的不顯示（清單裡已有的原樣保留，平台重新開放時租戶原本的選擇仍在） | 至少一個，或 `null`（全部） |
| `requireAll` | 「所有人都必須啟用」 | 要求時允許的方式不能是空的 |
| `requiredRoleIds` | 角色多選（列出系統角色與自訂角色） | 角色存在；同上 |

- 必帶 `version`（樂觀鎖，`409 MFA_POLICY_VERSION_CONFLICT`）；沒有列時的預設政策 `version = 1`，第一次 `PUT` 建立它。稽核 `mfaPolicy.update`（`before`／`after`、`severity: high`）。
- `allowedMethods` 不接受空陣列（要全部就是 `null`）；必須啟用時「平台開放 ∩ 允許」不能是空的（`VALIDATION_FAILED`，`fields.allowedMethods = 'MFA_POLICY_NO_METHOD'`）。
- `POST /mfa/policy/preview`（`mfaPolicy:read`）：送出前的影響——套用之後「必須啟用卻還沒設定」與「只剩不允許的方式、沒有備用碼」的人數；頁面據此先確認。
- **收緊立即生效、但不踢人**：已登入的人下一次登入才被要求設定；頁面上顯示「目前不符合政策的人數」（必須啟用卻沒有因子），可以點進使用者列表，名單與人數同一個條件：`mfa=false&status=active`，只要求特定角色時再加 `roleId=…&includeGroupRoles=true`
  （`GET /users` 的 `includeGroupRoles`：角色篩選也算經由群組、含巢狀持有的人）。
- 從允許清單拿掉某種方式時與 §5 一樣先顯示受影響的人數。
- 權限 `mfaPolicy:update` 預設只給 super-admin：放寬 MFA 等於削弱所有人的保護，比一般的 `system:update` 敏感（D11）。
- 讀政策不做快取：只有登入互動、政策頁與「不符合政策的人數」會讀，一次查詢。

## 7. 自助管理（帳號設定）

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
- 畫面：backstage 與 apps/platform 的 `/profile` 都加「多重驗證」區塊（web-core 的 `MfaSecuritySection`，打哪個端點由 app 給的 `MfaSelfApi` 決定）。
- `enrollAt: 'idp'` 的方式（之後的 WebAuthn）在 backstage 只顯示「到帳號中心設定」的連結（D14）。

### 7.1 只能在 apps/platform 設定的方式：重新登入並新增

WebAuthn 的憑證綁 RP ID（預設是 apps/platform 的網域）。backstage 在租戶網域，在那裡註冊的憑證到了 apps/platform 的登入互動用不了，所以租戶的使用者要到 apps/platform 註冊（D14）。
但租戶的使用者在 apps/platform 沒有 app session，只有登入互動。做法照 Keycloak 的 application initiated action：

```
backstage /profile「新增驗證方式」→ 選「安全金鑰」（enrollAt: 'idp'）
  └─ 頂層跳轉 /oidc/auth?…&tenant=<代碼>&prompt=login&mfa_enroll=webauthn（returnTo /profile）
       provider：mfa_enroll 只接受 backstage、enrollAt 'idp' 的方式，而且必須同時帶 prompt=login（否則已有 IdP session 的人不進互動，要求就被略過）
  └─ apps/platform 互動頁：顯示「為了新增安全金鑰，請先重新驗證身分」（`SsoInteraction.mfaEnroll`）
       密碼 → requirementFor（§4.1）
       ├─ none       → MfaPending { next: 'mfaEnroll', enroll, optional: true, amr: ['pwd'] } → { next: 'mfaEnroll', methods: [webauthn], optional: true }
       ├─ challenge  → MfaPending { next: 'mfa', enroll }；第二步通過後以條件式更新換成 { next: 'mfaEnroll', optional: true, amr: [第二步的 amr] }，
       │               `…/mfa/verify` 回傳設定的下一步而不是 resume 網址（`MfaLoginVerifyResult`）
       └─ enroll     → 政策要求的首次設定照舊（可以選任何可用的方式、不能略過）
  └─ 設定（`…/mfa/enroll`，optional 時只能設定要求的那一種）→ 確認 → 完成互動（amr 用第二步的）→ 回到 backstage /profile
     或「略過，直接登入」（`POST …/mfa/enroll/skip`；政策要求的首次設定回 `409 AUTH_MFA_ENROLL_REQUIRED`）
```

- 要求的方式目前不能用（被關掉、政策不允許、參數沒填）時當作沒要求，照常登入。
- 自助端點（`POST /auth/mfa/factors`）照舊拒絕租戶使用者設定 `enrollAt: 'idp'` 的方式（`409 MFA_METHOD_DISABLED`）。平台管理者的個人資料頁就在 apps/platform，直接設定。
- 經外部 IdP 登入的人沒有密碼步驟，這條路不適用（外部 IdP 的登入照 D9 不經過第二步，也不處理 `mfa_enroll`）。

## 8. 管理員檢視與重設

| 端點 | 權限 | 說明 |
| --- | --- | --- |
| `GET /users/:id/mfa` | `user:read` | 因子的方式、名稱、設定與最後使用時間；不含機密與 email hint 以外的資訊 |
| `POST /users/:id/mfa/reset` | `user:resetMfa` | 刪除所有因子與備用碼、`token_version + 1`（結束所有 session，發 `SESSIONS_REVOKED`）、寄通知信；稽核 `user.mfa.reset`（`severity: high`） |
| `GET`／`POST /platform/admins/:id/mfa`、`…/reset` | `platformAdmin:read`／`platformAdmin:resetMfa` | 同上；不能重設自己（`AUTHZ_SELF_MODIFY`，與其他自我修改相同） |

- **反提權**：目標持有 super-admin（含經由群組）時，操作者也必須持有 super-admin（與服務帳號的規則相同，[`04-auth.md`](04-auth.md) §8.2）。
  否則 admin 可以拆掉 super-admin 的 MFA，再配合外洩的密碼登入。
- 使用者列表加「MFA」欄（`users.mfa_enabled`）與篩選；使用者詳情加「驗證方式」區塊與「重設 MFA」按鈕。
- 災難復原：`cli:reset-super-admin` 加 `--reset-mfa`（唯一的 super-admin 弄丟手機又沒有備用碼時）。

## 9. 兩種方式

### 9.1 TOTP（`modules/mfa-totp`）

| 項目 | 值 |
| --- | --- |
| 演算法 | RFC 6238：HMAC-SHA1、6 位數、30 秒（各家驗證器 App 都支援的組合；SHA-256 在部分 App 會算錯） |
| seed | 20 bytes 隨機，base32；`SecretBox` 加密存 `secret_encrypted` |
| 容許誤差 | 前後各 1 個時間步 |
| 設定 | `beginEnrollment` 回 `otpauth://totp/<issuer>:<email>?secret=…&issuer=…`；issuer 是租戶名稱（平台管理者是「B2B Platform」）。前端以 `qrcode` 產生 QR code，並提供「無法掃描」時的手動輸入金鑰 |
| 重放 | 回傳 `counter`，框架存 `last_used_counter` |
| 實作 | `core/mfa/totp.ts` 自己實作（node:crypto 約 40 行，附 RFC 4226／6238 的測試向量），不加依賴 |

`otpauth` URI 含 seed：只出現在設定的回應裡，不寫日誌（`core/logger/redact.ts` 加回應欄位的遮蔽）、不進稽核。

### 9.2 Email 驗證碼（`modules/mfa-email`）

| 項目 | 值 |
| --- | --- |
| 收件地址 | 帳號目前的 email（不另存）；`describe` 顯示 `w***@example.com` |
| 驗證碼 | 6 位數，`crypto.randomInt`；10 分鐘；一個 challenge 最多錯 5 次 |
| 寄送 | `startChallenge` 寫 challenge（還沒有碼）並在交易內入列 `mfa.emailCodeMail { accountId, challengeId }`（平台管理者是 `mfa.platformEmailCodeMail`，交易提交後送出）。**碼在寄出當下由工作產生**：工作經 `MfaChallengeDelivery` 確認帳號仍可登入、challenge 仍有效，寫入 HMAC 後寄出（[`11-mail.md`](11-mail.md) §4 的規則：工作資料不含碼）；重試會換新的碼。驗證碼信不寫 `mail.send` 稽核 |
| 寄送延遲 | 每種工作本來就是自己的佇列，不必優先度；但租戶的 `job.maxConcurrency` 是所有工作合計，公告大量寄信時驗證碼信會被放回佇列。所以驗證碼信的 `JobType` 宣告 `ignoreTenantConcurrency`（[`10-jobs.md`](10-jobs.md) §3：不受上限限制、也不佔名額），重試縮成 3 次、10 秒起跳（碼 10 分鐘就過期）。登入頁提示「信件可能需要一分鐘」並提供重寄（60 秒冷卻） |
| 設定 | 開始設定時就寄一封；輸入正確才算設定完成（確認收得到） |
| 平台管理者 | 以平台脈絡寄出（與 `platformAdmin.accountMail` 相同）；預設不開放（`PLATFORM_MFA_METHODS` 加上 `email` 才有，D10） |

**已知的弱點**（寫進正式文件）：Email 與「忘記密碼」走同一個信箱。信箱被入侵的人可以重設密碼、也收得到驗證碼，所以 Email 擋得住
**密碼外洩、撞庫**，擋不住 **信箱被入侵**。要擋後者的帳號應該用 TOTP；這一版的政策不限制「必須啟用的角色不能只用 Email」（N2、D16）。

### 9.3 WebAuthn（`modules/mfa-webauthn`）

| 項目 | 值 |
| --- | --- |
| 函式庫 | `@simplewebauthn/server`（api）、`@simplewebauthn/browser`（web-core，只在方式的元件裡 `import()`） |
| 平台參數 | `rpName`（必填，瀏覽器顯示的服務名稱）、`rpId`（選填；預設是 `PLATFORM_APP_URL` 的網域，只能是它或它的上層網域，否則儲存時 `MFA_WEBAUTHN_RPID_MISMATCH`）、`userVerification`（`preferred`／`required`／`discouraged`）、`authenticatorAttachment`（`any`／`platform`／`crossPlatform`） |
| 設定 | `startChallenge(enroll)` 產生 registration options（`attestationType: 'none'`、`residentKey: 'preferred'`、排除已註冊的憑證），challenge 存在 `mfa_challenges.state`；options 經 `publicData` 給前端。user handle 是 SHA-256(`t:{tenantId}:{userId}` 或 `p:{adminId}`)：同一個 email 在不同租戶是不同的帳號，也不把 email 交給驗證器當 id |
| 確認 | `verifyRegistrationResponse`（expected origin 是 apps/platform 的 origin、RP ID 是 challenge 記下的）；通過時 `factorUpdate.config` 存憑證 id、公鑰（base64url）、RP ID、transports、裝置類型、是否已備份 |
| 登入 | 選到因子時前端先取得 challenge（不需要點擊），再由使用者按下按鈕呼叫瀏覽器 API（Safari 要求在點擊裡呼叫）。以 **註冊時的 RP ID** 產生 authentication options；`verifyAuthenticationResponse` 帶存的計數 |
| 計數 | 簽章計數大於 0 時交給框架（`last_used_counter`，倒退視為複製的憑證而拒絕）；同步型的通行金鑰永遠回 0，不交給框架比較 |
| amr | `hwk`（RFC 8176）；稽核另外記方式 id |
| 逾時 | challenge 與瀏覽器 API 都是 5 分鐘；沒有重送冷卻（使用者取消後可以馬上再試） |
| 取代密碼 | 平台參數 `passkeyLogin`（`disabled`／`enabled`，不是必填、預設 `disabled`）：開啟後登入頁多一個「使用通行金鑰登入」，以 discoverable credential 的流程（不帶 `allowCredentials`、一定要求使用者驗證）登入，不經密碼與第二步。方式實作 `passwordless`，驗證仍走 `verify`。見 [`../04-sso.md`](../04-sso.md) §3.6 |

### 9.4 簡訊驗證碼（`modules/mfa-sms`）

| 項目 | 值 |
| --- | --- |
| 平台參數 | `provider`（`twilio`／`webhook`）；Twilio：`twilioAccountSid`、`twilioAuthToken`（機密）、`twilioFrom`（E.164 號碼、Messaging Service SID 或英數寄件者）；自訂閘道：`webhookUrl`、`webhookSecret`（機密）；`allowedCountryCodes`（必填，預設 `886`） |
| 儲存的檢查 | Twilio：格式後以金鑰讀取帳號（`GET /2010-04-01/Accounts/{sid}.json`，401 → Auth Token 被拒、404 → SID 被拒）；自訂閘道：production 只接受 https、不能是內部網路（`assertPublicDestination`），再送一個 `{ type: 'ping' }`（要回 2xx） |
| 設定 | 輸入號碼（`enrollSchema`：去掉空白與連字號後必須是 E.164；前端把國碼與國內號碼組好，去掉開頭的 0），國碼不在 `allowedCountryCodes` 回 `VALIDATION_FAILED`（`fields['input.phone'] = 'MFA_PHONE_COUNTRY_NOT_ALLOWED'`）。號碼加密存 `secret_encrypted`，`config.phoneMasked`（`+8869*****678`）給列表與登入頁 |
| 驗證碼 | 與 Email 相同：6 位數、10 分鐘、60 秒重送冷卻、challenge 只存 HMAC、碼在 **送出當下** 由工作產生（`mfa.smsCode`／`mfa.platformSmsCode`，`ignoreTenantConcurrency`、重試 3 次） |
| 內容 | `【{租戶名稱}】驗證碼 123456，10 分鐘內有效。請勿提供給任何人。`（帳號語系不是中文時用英文）；簡訊按則計費，只放必要的資訊 |
| 自訂閘道的格式 | `POST` JSON `{ type: 'mfa.code', to, text, code, locale, expiresInSeconds }`；`X-B2B-Timestamp`（Unix 秒）、`X-B2B-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`；不跟隨轉址、10 秒逾時、production 不連私有網段 |
| 防灌量 | 國碼白名單、端點的 `authMail` 速率限制、每個因子的冷卻；設定時要先通過密碼（或登入），所以匿名的人送不了 |
| amr | `sms`（RFC 8176） |

**已知的弱點**：SIM 換卡、SS7 攔截、手機遺失後的轉移（`assurance: 'messaging'`）。要防這些的帳號應該用 WebAuthn 或驗證器 App。

### 9.5 通訊軟體：Telegram、LINE（`modules/mfa-messaging`）

兩者共用 `MessagingMfaMethod` 的流程，差別在 `MessagingChannel`（送訊息、綁定的說明、解析 webhook、檢查參數）。Bot 不能主動找人，所以設定時要先 **綁定**：

```
開始設定（enrollChallenge: 'onRequest'：這時不發 challenge）
  └─ 產生綁定碼（Telegram：24 字元的 start 參數；LINE：8 碼 Crockford base32，K7Q2-M9XD），mfa_channel_links 只存 HMAC，30 分鐘
  └─ 前端顯示 QR code／連結（t.me/<bot>?start=<碼>；LINE 先加好友，再 oaMessage 帶入綁定碼）與手動輸入的文字
使用者在 App 裡傳綁定碼給 Bot
  └─ webhook（平台層，不知道是哪個租戶）以綁定碼的 HMAC 找到那一列，加密存下收件對象（chat id／user id）與顯示名稱，回覆「已完成綁定」
使用者回到網頁按「已完成綁定，傳送驗證碼」（POST …/factors/:id/challenge）
  └─ 還沒綁定 → 409 MFA_CHANNEL_NOT_LINKED；綁定了 → 收件對象放進 challenge、入列送碼的工作
輸入 Bot 傳來的 6 位數 → 確認：收件對象經 factorUpdate.secret 搬進因子（之後登入不再查綁定）
```

| 項目 | Telegram | LINE |
| --- | --- | --- |
| 平台參數 | `botToken`（機密）；`botUsername` 儲存時以 `getMe` 取得 | `channelAccessToken`、`channelSecret`（機密）；`botBasicId` 儲存時以 `GET /v2/bot/info` 取得 |
| 儲存時 | `setWebhook`（網址、`secret_token`、只收 `message`） | `PUT /v2/bot/channel/webhook/endpoint` |
| webhook | `POST /mfa-channels/telegram/webhook`，`X-Telegram-Bot-Api-Secret-Token` 必須等於 SHA-256(`mfa-telegram-webhook:` ‖ token)（不另外存，換 token 時跟著換） | `POST /mfa-channels/line/webhook`，`X-Line-Signature` = base64(HMAC-SHA256(channel secret, **原始本體**))；api 只對這條路由保留原始本體（`registerMfaChannelBodyParser`） |
| 只處理 | 私訊的 `/start <碼>` | 一對一聊天的文字訊息（取最後 8 碼，容許小寫、空白、O／0、I／L／1） |
| 送出 | `sendMessage`（`protect_content`） | push message（計入官方帳號的訊息額度） |
| amr | `telegram`（非登記值，同 Email 的理由，D12） | `line` |

- webhook 的網址取自 `OIDC_ISSUER` 的 origin 與 api 前綴（例：`https://auth.example.com/api/mfa-channels/telegram/webhook`）：與登入互動同一個 origin，反向代理已經轉 `/api`。
- webhook 是 `@Public()`、不走速率限制（來源是供應商的少數 IP，偽造的請求在簽章就被擋下），簽章不符回 401；處理失敗也回 200（供應商會重送，綁定碼只能用一次）。不在 OpenAPI。
- 綁定碼本身不能完成設定：收到驗證碼的人必須回到 **同一個設定流程** 輸入碼。別人拿到連結去綁定，只會讓設定無法完成。
- 過期的綁定由 `mfa.channelLinkCleanup`（平台工作，沿用 `AUTH_TOKEN_CLEANUP_CRON`）刪除。
- **已知的弱點**：通訊軟體帳號被盜（多半也是靠簡訊重設），與簡訊同級（`assurance: 'messaging'`）。

## 10. 直接登入與其他路徑

- 直接 `POST /auth/login`（[`04-auth.md`](04-auth.md) §8.2）：帳號有 active 因子、或必須啟用時回 `403 AUTH_MFA_REQUIRED`。腳本改用 API token。
- API token、服務帳號：不受影響（token 本身就是憑證；服務帳號沒有密碼登入）。
- 帳號流程（啟用、重設密碼）：不經過 MFA；完成後回到登入，下一次登入照常要求第二步。重設密碼 **不清除** 因子。

## 11. 前端

**註冊表**（`@b2b-system/web-core/mfa`，照 [`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §6 的共同規則：重複註冊丟例外、讀取 miss 丟例外、React 端訂閱）：

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

- 內建的方式放 `web-core/mfa/methods/`，由兩個 app 的 `app/plugin.ts` 登記（apps/platform 的登入互動、兩個 app 的帳號設定都要用），依強度排序：WebAuthn、TOTP、簡訊、Telegram、LINE、Email。
- 設定前要先填資料的方式（簡訊的號碼）多一個 `EnrollStart` 元件；`enrollAt: 'idp'` 的方式在 backstage 由 `MfaSelfApi.enrollElsewhere` 改走 §7.1。細節見 [`../frontend/20-mfa.md`](../frontend/20-mfa.md)。
- 伺服器回傳註冊表裡沒有的方式 id（例：api 先部署了新方式）時，該因子顯示為「這個版本不支援」、不可選，不讓畫面壞掉。
- apps/platform `features/login` 的互動頁：密碼步驟 → 依 `next` 切到 `MfaChallengeForm`（選因子、輸入碼、「改用備用碼」、重寄倒數沿用 `useCountdown`）或 `MfaEnrollFlow`（選方式 → 方式的 `Enroll` → `RecoveryCodesDialog`）。
- 備用碼對話框：顯示、複製、下載 `.txt`；要勾「我已保存」才能關。
- backstage：`/profile` 的「多重驗證」區塊、`features/user` 的 MFA 欄與篩選（`?mfa=false`，route id `user.listByMfa`、`user.listByMfaRole`）、詳情的驗證方式與重設、`features/security`（租戶的安全政策頁，分頁式容器：MFA 是第一個分頁 `/security/mfa`，之後的安全政策可以加自己的分頁）。apps/platform：`/profile`、`/mfa-method`（平台開關頁，`features/mfa-method`）、租戶詳情的 `?tab=mfa`、平台管理者的編輯對話框（驗證方式與重設；沒有詳情頁）。
- 權限：`features/security/permission.ts` 註冊 `/system/security` 的 page key（`mfaPolicy:read`）。

## 12. 權限、錯誤碼、稽核、指標

**權限**（同步 `docs/architecture/iam/02-permission-catalog.md`、`db/seeds/permissions.ts`、前端 `permission.ts`、兩個語系檔）：

| 鍵 | 範圍 | 預設持有 |
| --- | --- | --- |
| `mfaPolicy:read` | 租戶 | super-admin、admin、auditor |
| `mfaPolicy:update` | 租戶 | super-admin |
| `mfaMethod:read` | 平台 | 所有平台角色 |
| `mfaMethod:update` | 平台 | 平台 super-admin |

**錯誤碼**（`packages/error-codes` ＋ web-core 的 `ERROR_MESSAGE_KEY` 與語系；apps/platform 也要翻譯）：
`AUTH_MFA_REQUIRED`、`AUTH_MFA_INVALID_CODE`、`AUTH_MFA_CHALLENGE_EXPIRED`、`AUTH_MFA_TOO_MANY_ATTEMPTS`、`AUTH_MFA_UNAVAILABLE`、`AUTH_MFA_PENDING_INVALID`（互動的第二步已作廢）、
`MFA_METHOD_NOT_FOUND`、`MFA_METHOD_DISABLED`、`MFA_FACTOR_NOT_FOUND`、`MFA_FACTOR_LIMIT_REACHED`、`MFA_LAST_FACTOR`、`MFA_POLICY_VERSION_CONFLICT`；
第二版加上 `AUTH_MFA_ENROLL_REQUIRED`（§7.1 政策要求的首次設定不能略過）、`MFA_METHOD_NOT_CONFIGURED`、`MFA_METHOD_SETTINGS_CHECK_FAILED`、`MFA_METHOD_SETTINGS_VERSION_CONFLICT`、
`MFA_METHOD_SETTINGS_IN_USE`（§5.1）、`MFA_CHANNEL_NOT_LINKED`（§9.5）。參數欄位的原因代碼（`MFA_SETTING_REQUIRED`、`MFA_SETTING_REJECTED`…）在 web-core 語系的 `mfa.settings.error.*`。

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
| 平台：`mfaMethod.configure`／`mfaMethod.unconfigure` | 儲存、刪除平台參數（§5.1） | 一般欄位的 `before`／`after`、`secretsChanged`（只有鍵），`severity: high` |

**指標**（`core/metrics/instruments.ts`，[`08-monitoring.md`](../08-monitoring.md) §2.4；標籤不帶租戶）：
`api_mfa_verifications_total{method, purpose, result}`、`api_mfa_challenges_sent_total{method}`（簡訊、Telegram、LINE 也記）、`api_mfa_email_delivery_seconds`（challenge 建立到寄出）。
告警 `MfaEmailCodeSlow`：Email 驗證碼寄送延遲的 p95 超過 60 秒持續 10 分鐘（平台管理者據此決定要不要暫時全平台關掉 Email）。

## 13. 設定與部署

| 變數 | 用途 | production |
| --- | --- | --- |
| `MFA_SECRET_KEY` | 加密 TOTP seed、Email 驗證碼的 HMAC 金鑰（32 bytes，base64） | 必填（同 `IDP_SECRET_KEY` 的檢查） |
| `PLATFORM_MFA_REQUIRED` | 平台管理者必須啟用 | 預設 `true`；`NODE_ENV=production` 設成 `false` 會啟動失敗。開發環境預設 `false` |
| `PLATFORM_MFA_METHODS` | 平台管理者可用的方式（逗號分隔） | 預設 `totp`；不能是空的、不能含註冊表沒有的 id。需要參數的方式在參數填齊之前即使列了也不能用 |
| `MFA_TWILIO_API_URL`、`MFA_TELEGRAM_API_URL`、`MFA_LINE_API_URL` | 供應商 API 的位址（金鑰與 token 不在 env，是 §5.1 的平台參數） | 預設是各家的正式位址；production 必須是 https。只有開發與 E2E 指向模擬服務 |

- 開發環境的平台管理者在 `PLATFORM_MFA_REQUIRED=true` 時下一次登入走「首次設定」。`PLATFORM_MFA_METHODS` 不在註冊表的方式在啟動時擋下（`MfaAvailability.onApplicationBootstrap`）。
- 開發與 E2E：`db:seed:dev`／`db:seed:e2e` 的帳號不設因子、政策不要求；E2E 的 MFA 測試以 fixture 直接寫入已知 seed 的 TOTP 因子，測試輔助用 `core/mfa/totp.ts` 算碼；Email 走 Mailpit。
- **模擬的簡訊與通訊軟體服務**（`pnpm dev:mock-messaging`，:4466，`apps/api/scripts/mock-messaging.ts`）：Twilio、自訂閘道（`<url>/sms-gateway`）、Telegram Bot API、LINE Messaging API 各實作用得到的端點；
  `GET /_mock/messages?to=` 看送出的訊息（附解析出的碼），`POST /_mock/telegram/start { code, chatId }`、`POST /_mock/line/message { userId, text }` 模擬使用者傳訊給 Bot（會呼叫 api 登記的 webhook）。
  api 設 `MFA_*_API_URL=http://localhost:4466` 之後，在平台參數填模擬服務的預設值（Twilio SID `AC000…0`／token `mock-twilio-token`、Telegram token `123456:mock-telegram-token-abcdefghij`、
  LINE token `mock-line-access-token`／secret `mock-line-channel-secret`、閘道密鑰 `mock-sms-secret`）。api 的整合測試以同一支程式起在隨機埠。

---

## 14. 測試

| 層 | 檔案 | 涵蓋 |
| --- | --- | --- |
| 單元 | `core/mfa/__tests__/totp.spec.ts` | RFC 4226 附錄 D、RFC 6238 附錄 B 的測試向量（SHA-1／256／512）、前後一步的容許、時間步邊界、格式、base32、otpauth URI |
| 單元 | `core/mfa/__tests__/recovery-code.spec.ts`、`mfa-method.registry.spec.ts` | 備用碼的格式、正規化、雜湊；註冊表的重複、格式、保留字、身分範圍 |
| 單元 | `core/feature-flags/__tests__/feature-flags.spec.ts`、`core/jobs/__tests__/job-queue.spec.ts` | `resolveToggle` 的四種組合；`ignoreTenantConcurrency` 的工作不判斷上限 |
| 單元 | `modules/mfa/__tests__/mfa-login.requirement.spec.ts` | §4.1 的判斷表（challenge／enroll／none／unavailable，含方式被關掉、pending 因子、程式移除的方式） |
| api 整合 | `test/mfa.spec.ts` | 自助設定與移除（密碼確認）、第二步（不能只拿 resume 網址跳過、amr）、重放、互動 5 次作廢與鎖定計數、備用碼只能用一次、`SESSIONS_REVOKED` 作廢 `MfaPending`、直接登入拒絕、管理員重設（session、稽核、不能重設自己、super-admin 的反提權）、政策的首次設定與樂觀鎖、全平台關閉後的備用碼出路與 `AUTH_MFA_UNAVAILABLE`、兩級覆寫、平台管理者同一套流程 |
| api 整合 | `test/mfa-email.spec.ts` | 碼不在工作資料、DB 只存 HMAC、重寄冷卻（429）與重寄後舊碼失效、challenge 錯 5 次作廢、寄出前帳號已停用則略過、安全通知信 |
| 前端 | `web-core/src/mfa/__tests__/mfa.test.tsx` | 註冊表（重複、miss）、CodeInput、不支援的方式的顯示、備用碼對話框要勾「已保存」、第二步作廢交給呼叫端 |
| 前端 | backstage `features/security/…/MfaPolicyPage.test.tsx`、`features/user/…/UserMfaSection.test.tsx`；apps/platform `Interaction/__tests__` | 政策頁的三個權限案例與預覽確認；使用者詳情的重設；互動頁的第二步與作廢後回到密碼 |
| E2E | `apps/e2e/tests/mfa.spec.ts` | 驗證器 App 設定 → 以驗證碼登入 → 以備用碼登入；Email 驗證碼經 Mailpit；政策要求角色後的首次設定；平台全面關閉後改用備用碼。帳號 `e2e-mfame`／`e2e-mfamail`／`e2e-mfapolicy`，依序執行 |

第二版的測試：

| 層 | 檔案 | 涵蓋 |
| --- | --- | --- |
| 單元 | `core/mfa/__tests__/mfa-method-settings.spec.ts` | 必填（含條件）、選項、網址、長度；參數定義的錯誤讓登記失敗；需要參數的方式不能預設開啟；`isConfigured` |
| 單元 | `modules/mfa/__tests__/mfa-method-settings.service.spec.ts` | 加密存放、機密的沿用／清除／換新、樂觀鎖、方式的檢查不通過不寫入、`derived` 只存定義過的欄位、稽核不含機密、在用時不能刪除、解不開的列略過 |
| 單元 | `mfa-login.service.spec.ts`、`mfa.service.spec.ts`、`mfa-availability.service.spec.ts`、`platform-mfa-method.service.spec.ts`、`platform-tenant.service.spec.ts` | §7.1 的各條路徑（直接設定、先過第二步、併發、略過、只能設定要求的方式）；`enrollSchema`、`onRequest`、`publicData`、`factorUpdate`；沒填參數不能用、不能開啟 |
| 單元 | `modules/mfa-sms/__tests__/sms.spec.ts`、`mfa-messaging/__tests__/messaging.spec.ts`、`mfa-webauthn/__tests__/webauthn.method.spec.ts` | 供應商的請求格式與簽章、參數的檢查、綁定碼只存 HMAC、未綁定 409、webhook 的解析與回覆、WebAuthn 的 options 與驗證結果的對應（函式庫以 mock 取代） |
| api 整合 | `test/mfa-methods.spec.ts` | 以模擬服務當供應商：沒參數不能開啟、供應商拒絕金鑰、必填、加密與在用不能刪除；簡訊的設定與登入；Telegram／LINE 的綁定（簽章不對 401）與設定；`mfa_enroll` 的授權檢查、可略過的設定、自助端點拒絕 WebAuthn |
| 前端 | `web-core/src/mfa/__tests__/mfa-methods.test.tsx`、apps/platform `MfaMethodSettingsDialog.test.tsx`、`TenantMfaMethods.test.tsx`、`InteractionPage.test.tsx`、`useMfaInteraction.test.tsx` | 號碼的格式、先填號碼再開始設定、綁定 → 請求 → 輸入碼、WebAuthn 交給 `enrollElsewhere`／呼叫瀏覽器 API／取消；參數表單的條件欄位、機密沿用、欄位錯誤；開關的「開」不能選；互動頁的說明、驗證後換成設定、略過 |

WebAuthn 的實際註冊與登入（真的驗證器）沒有自動化測試：函式庫的密碼學驗證由它自己的測試保證，我們的測試涵蓋到交給函式庫的參數與結果的對應；瀏覽器驗證在沒有虛擬驗證器的環境做到註冊畫面為止。

E2E 以 seed 算 TOTP 碼（`apps/e2e/helpers/totp.ts`）；同一個時間步只能用一次，第二次要等下一個 30 秒。api 整合測試以假的時鐘（`vi.setSystemTime`）推進時間步。

---

## 15. 設計決策：MFA

### 15.1 D 表

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **方式是登記進註冊表的模組**（`MfaMethod` 介面 ＋ `MfaMethodRegistry.register`，在 `onModuleInit`） | 與審批 handler、系統設定、標籤的資源類型相同的模式；`modules/mfa` 不必認識任何方式，新增方式不改框架 |
| D2 | **方式只做「產生、驗證」，不寫 DB、不計數** | 失敗次數、鎖定、重放的儲存、稽核、`consumed` 若由每種方式自己做，第三種方式一定會漏；集中在框架才能保證一致 |
| D3 | **與方式無關的資料表**（`mfa_factors` 的 `secret_encrypted` ＋ `config jsonb`；`mfa_challenges.state jsonb`），不是每種方式一張表 | 新方式不必 migration；WebAuthn 的公鑰與 counter 放得進 `config`／`last_used_counter` |
| D4 | **平台層開關照 feature flag 的兩級覆寫與判斷規則**，共用 `resolveToggle`；但沒有 `removeBy` | 平台管理者只要學一套規則；方式是長期功能，不是試行開關 |
| D5 | **方式不知道身分範圍**：帳號、因子、challenge 經 `MfaAccountStore`（租戶、平台兩個實作）讀寫 | 同一份 TOTP 實作同時服務兩個 DB；身分範圍的規則（[`04-sso.md`](../04-sso.md) §1.1）留在框架 |
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

| D17 | **需要外部服務的方式以「平台參數」設定，必填填齊之前不能開啟**；參數由方式宣告欄位，表單由前端依定義產生 | 方式一開啟就要能用：沒有金鑰的簡訊方式開啟後，使用者會卡在「收不到碼」而且被當成登入失敗。把前置條件放在開關上（伺服器擋、前端停用），比上線後出錯好。欄位由方式宣告，框架與平台頁不必認識每家供應商 |
| D18 | **參數只有平台一份**，租戶不能自帶簡訊供應商或 Bot | 先求一套能運作；租戶各自的金鑰要處理費用歸屬、租戶層的加密與輪替，等有實際需求再加（`mfa_method_settings` 加 `tenant_id` 即可延伸） |
| D19 | **WebAuthn 只能在 apps/platform 註冊，租戶的使用者以 `prompt=login&mfa_enroll=<id>` 進入登入互動設定**（§7.1） | 憑證綁 RP ID；登入在 apps/platform，在租戶網域註冊的憑證用不了。Related Origins（`/.well-known/webauthn`）最多 5 個網域、瀏覽器支援不完整，對應不了「每個租戶一個網域」。強制重新登入兼作 step-up：要先通過既有的第二步才能新增 |
| D20 | ~~**WebAuthn 只當第二因素**，不做無密碼登入~~ **更新（10-09）**：可以取代密碼，由平台參數 `passkeyLogin` 開啟（預設關閉），見 [`../04-sso.md`](../04-sso.md) §3.6、§12.6 D9、D10 | 當初的理由（改到第一步、鎖定與 amr 的語意）以「方式的選用能力 `passwordless` ＋ 框架的 `verifyFactor`」解決：第一步之外的流程不變、失敗不累計鎖定、amr 是 `['hwk', 'mfa']`；憑證與因子是同一筆，沒有新的資料表 |
| D21 | **通訊軟體以「綁定碼 → webhook」連結帳號**，綁定放平台 DB，確認之後收件對象搬進因子 | Bot 不能主動找人，只能等使用者傳訊；webhook 只有一個網址、收到時不知道租戶，所以綁定要放平台 DB；確認後搬進租戶 DB 的因子，登入時不再跨 DB 查詢。綁定碼只存 HMAC，DB 外洩時拿不到還沒用掉的碼 |
| D22 | **簡訊只送到平台允許的國碼** | 簡訊灌量詐騙（SMS pumping）以高費率國家的號碼刷簡訊；白名單是供應商端之外最直接的防線 |
| D23 | **供應商的 API 位址在 env、金鑰在平台參數** | 位址是部署層級的（正式 vs 模擬），金鑰是營運層級的（換金鑰不必重新部署）；production 強制 https |

### 15.2 評估過的方案

| 方案 | 不選的理由 |
| --- | --- |
| 直接用 feature flag 的目錄與表（每種方式一個 flag） | flag 有 `removeBy`、到期測試失敗；方式要長期存在，語意不同。共用的是判斷規則（`resolveToggle`），不是表 |
| 方式各自一張表（`totp_factors`、`email_factors`） | 每加一種方式要 migration、要改列表與重設的查詢；違背「新增方式不改框架」 |
| 用 `otpauth`／`otplib` 套件 | TOTP 本身約 40 行，有 RFC 測試向量可驗證；少一個要追蹤安全更新的依賴 |
| 第二步做成 oidc-provider 的另一個 prompt（`prompt: 'mfa'`） | 要改 provider 的 policy 與互動的 resume 流程；`MfaPending` 只是在同一個互動裡多存一筆，改動小且與外部登入的 `ExternalLogin` 對稱 |
| Email 驗證碼在 HTTP 請求內同步寄出（不入列） | 違反 [`11-mail.md`](11-mail.md) §4「寄信一律入列」；SMTP 慢或失敗會讓登入請求卡住。以優先度與告警處理延遲 |
| 「必須啟用」的人在方式被關掉時改走首次設定 | 見 D8 |
| 平台參數放 env（`TWILIO_AUTH_TOKEN` 之類） | 換金鑰要重新部署；env 沒辦法在開啟前檢查「填齊、可用」；方式的開關在 DB，前置條件也要在 DB 才能一起判斷 |
| 參數放系統設定（`SettingService`） | 系統設定是租戶層、只存純量，沒有機密欄位與跨欄位的檢查（選了 Twilio 才要 SID） |
| WebAuthn 在 backstage 註冊（每個租戶網域一個 RP ID） | 登入在 apps/platform，憑證用不了（D19） |
| 通訊軟體以使用者輸入 chat id 綁定 | 使用者不知道自己的 chat id；Bot 也不能主動送訊息給沒互動過的人 |
| 簡訊供應商直接用各家 SDK | 只用到「送一則簡訊」與「驗證金鑰」兩個呼叫；自訂閘道讓營運接任何供應商，不必每家寫一個實作 |

### 15.3 規劃時的問題與結論


1. WebAuthn／Passkey 要不要一起做？互動頁是同一個，但註冊流程與資料表不同。
   **結論**：第一版不做。介面已預留（`challenge: 'server'`、`enrollAt: 'idp'`、方式自己的 `state` 與 `config`），資料表不必改（D3、D14）。
   **第二版（10-09）**：做了（§9.3、§7.1）；資料表確實沒改，介面補了 `publicData`、`factorUpdate`、`activeFactors`（§15.4 M4）。
2. 外部 IdP 登入要不要另外要求我們的 MFA？
   **結論**：不要求，信任外部 IdP（D9）。
3. 「特定角色必須啟用」放在角色欄位上，還是系統設定？
   **結論**：都不是；放在租戶的 `mfa_policy`（`required_role_ids`），與允許的方式、全員要求放在同一處，由專門的端點做跨欄位檢查（D7）。
4. MFA 的設定頁放 backstage 的帳號設定，還是 apps/platform？
   **結論**：租戶使用者在 backstage 的 `/profile`、平台管理者在 apps/platform 的 `/profile`，元件共用 `web-core/mfa`；必須綁 origin 的方式（WebAuthn）之後只能在 apps/platform 設定（D14）。
5. 啟用或停用 MFA 時，要不要撤銷其他裝置的 session？
   **結論**：自助的新增、移除不撤銷（會連目前的 session 一起登出，且有變更密碼可以做）；管理員重設一律撤銷（§7、§8）。


- **N1. 平台層的「租戶覆寫」是否需要？** 只做全平台開關比較簡單；做了才能「先對某個租戶開放新方式試行」。
  **結論**：做。全平台 ＋ 租戶兩級，規則與 feature flag 相同（§5、D4），在 M3 實作。
- **N2. 政策要不要能限制「必須啟用的角色不能只用 Email」？** Email 擋不住信箱被入侵（§9.2）。
  **結論**：這一版不做限制。方式定義保留 `assurance`（`possession`／`inbox`），`mfa_policy` 不加欄位、沒有畫面；要做時的流程見 D16。
- **N3. 平台管理者要不要開放 Email？** 平台管理者沒有自助的「忘記密碼」，Email 的弱點比較小；但平台權限大。
  **結論**：預設只有 TOTP；`PLATFORM_MFA_METHODS` 可以加上 `email`（D10）。

### 15.4 實作紀錄

實作時與規劃不同的地方（M1 框架與 TOTP、M2 Email、M3 政策與開關）。

**M1（2026-10-07）**

1. **正式文件是 `backend/21-mfa.md`**：`backend/20` 已是審批（docs/rbac 併入 iam 時改號）。程式註解直接引用 21，實作期間先放一份指向本檔的入口，歸檔時改寫。
2. **「密碼通過」與「登入成功」分開**：原本 `verifyCredentials` 在密碼正確時就歸零失敗計數、記住來源（已知來源）、寫成功的稽核。
   有第二步之後這樣會出事——知道密碼的人每輸入一次密碼就把第二步的失敗計數歸零，而且他的 IP 會變成已知來源、之後第二步的錯誤不再累計鎖定。
   所以拆成「只檢查」與 `completeLogin`（第二步也通過之後才呼叫）：租戶的在 `modules/user/user-login.service.ts`（`UserLoginService`：`verifyPassword`、
   `recordFailedAttempt`、`completeLogin`），`AuthService.verifyCredentials` 改名 `checkCredentials`；平台的在 `PlatformAdminService`（`verifyPassword`、
   `recordFailedAttempt`、`completeLogin`，`verifyCredentials` 留給沒有第二步的呼叫端）。放在 `UserModule` 而不是 `AuthModule`：`AuthModule` 依賴 `MfaModule`，
   `MfaModule` 也要用鎖定的邏輯（規劃時列的兩個做法「公開 `registerFailedAttempt`」或「抽到共用的地方」，選了後者）。
3. **清理是 MFA 自己的工作**：`mfa.cleanup`（租戶）、`mfa.platformCleanup`（平台），沿用 `AUTH_TOKEN_CLEANUP_CRON`。不加進 `auth.tokenCleanup`：
   `credential` 是葉節點，不能依賴 `mfa`。
4. **`mfa_challenges.resend_after`**：重寄的冷卻（§4.2「同一因子 60 秒內不重寄」）要有地方存，M1 就建好，M2 不必 migration。
5. **12 個錯誤碼在 M1 全部加入**：框架把方式的失敗原因對到錯誤碼（`expired` → `AUTH_MFA_CHALLENGE_EXPIRED`）、政策的判斷（`MFA_METHOD_DISABLED`、`MFA_LAST_FACTOR`）
   都在 `modules/mfa`，M2 不能改流程，所以先備齊。
6. **互動中的首次設定（`enroll` 三個端點）M1 就做了**；M3 只在 `requirementFor` 補上「必須啟用」。
7. **與政策、開關、通知有關的判斷抽成兩個小 service**：`MfaAvailability`（可用的方式、是否必須啟用、能不能移除最後一個因子）、`MfaNotifier`（安全通知信）。
   M2、M3 只改它們，`MfaService`、`MfaLoginService` 的流程不動。M1 的 `MfaAvailability` 把平台管理者可用的方式寫死成 `totp`。
8. **介面的補充**：`startChallenge` 多收框架先產生的 challenge id（方式可以把它放進自己入列的工作，與 challenge 同一個交易）；
   `MfaAccountContext.enqueue`（租戶走 outbox、平台在提交後送出）；`MfaSecrets.hmac`（`SecretBox.deriveKey` 以 HKDF 推導的子金鑰）。
9. **`SESSIONS_REVOKED` 不另外刪除互動中 pending 的因子**：確認一定要有效的 `MfaPending`，它作廢之後 pending 的因子確認不了，24 小時後清除。
10. **指標名稱是 `api_mfa_verifications_total`**：沿用 `instruments.ts` 的 `api_` 前綴。
11. **`SsoRedirect` 的 schema 搬到 `modules/oidc-provider/sso-redirect.dto.ts`**：`mfa` 的互動端點也回傳它，而 `mfa` 不能 import `auth`。
12. **前端**：backstage 的「多重驗證」是個人資料頁的一個區塊（與 apps/platform 相同的 `MfaSecuritySection`），不是分頁；apps/platform 沒有平台管理者詳情頁，
    驗證方式與重設放在編輯對話框。web-core 不呼叫 app 的 API：元件收 app 給的函式（`MfaSelfApi`、`start`／`confirm`／`verify`）。`@b2b-system/ui` 加了 `smartphone`、`mail` 圖示。
13. **管理員重設不能重設自己**（租戶也是，`AUTHZ_SELF_MODIFY`）：自己的在個人資料頁管理。

**M2（2026-10-07）**

1. **方式的背景工作要讀寫 challenge**：Email 驗證碼在寄出當下才產生（工作資料只有 `{ accountId, challengeId }`），要把碼的 HMAC 寫回 challenge，
   而方式不能直接查 DB（D5），也不該依賴 `modules/mfa`。M1 的介面沒有這條路，所以在 `core/mfa` 加 `MfaChallengeDelivery`（`deliver(realm, accountId, challengeId, fn)`），
   `MfaService` 在 `onModuleInit` 以 `bind` 接上實作：確認帳號仍可登入、challenge 沒用掉也沒過期 → 方式產生狀態 → 寫回 → 寄出。
   這是 `modules/mfa` 唯一一處不是通知信的改動（新的進入點，既有的流程與 schema 不變）。
2. **兩個身分範圍各一種工作**：`mfa.emailCodeMail`（租戶，走 outbox）、`mfa.platformEmailCodeMail`（平台，提交後送出）；通知信同理
   （`mfa.securityNoticeMail`、`mfa.platformSecurityNoticeMail`）。平台的工作不能在租戶的交易裡入列，`scope` 不同就是不同的佇列。
3. **`core/jobs` 的 `ignoreTenantConcurrency`**：不受 `job.maxConcurrency` 限制、也不佔它的名額（只等不佔會讓其他工作多等它）。
   驗證碼信另外把重試縮成 3 次、10 秒起跳：碼 10 分鐘就過期，晚寄到沒用。
4. **驗證碼信不寫 `mail.send` 稽核**：每次登入都寄，第二步的結果已經在 `auth.login.*`；安全通知信照常寫。
5. **指標名稱**：`api_mfa_challenges_sent_total`、`api_mfa_email_delivery_seconds`（從 challenge 建立到寄出）；告警 `MfaEmailCodeSlow`（p95 > 60 秒、10 分鐘）。
6. **平台管理者的可用方式仍寫死 `totp`**（M2 時）：Email 的方式定義含 `platform`，但當時 `MfaAvailability` 還沒有 `PLATFORM_MFA_METHODS`（M3 加上）。
7. **驗收**：與 M1 的 commit 相比，`modules/mfa` 只有 `mfa-notifier.ts`（通知信的工作與入列）、`mails/mfa-security-notice.mail.tsx`，以及上面第 1 點的 `MfaService.deliverChallenge`；`db/` 沒有變更。

**M3（2026-10-07）**

1. **`resolveToggle` 放在 `core/feature-flags/feature-flags.ts`**，`resolveFeatureFlag` 改用它；MFA 的方式以同一個規則判斷（`MfaMethodOverrideService.isEnabled`）。
2. **全平台層的快取接上廣播**：`MfaMethodOverrideService` 以 `BroadcastService.channel('mfa_method_overrides')` 失效（本機寫入後立即重讀、再通知其他程序），另有 `TENANT_CACHE_TTL` 兜底。
3. **`TenantContext.mfaMethods` 是選填**：沒有（測試建的脈絡）= 不覆寫，免得每一處建脈絡的測試都要改。
4. **統計存在平台 DB 的 `mfa_method_stats`**（每日 `mfa.factorStats` 整份取代；含平台管理者的因子數），平台頁不即時查每個租戶 DB。
5. **影響人數是即時算的**：`GET /platform/mfa-methods/:id/impact?tenantId=` 逐一進租戶（`Tenancy.run`）以 `countStranded` 計算；進不去的租戶略過並回報數量。
   租戶的政策頁另有 `POST /mfa/policy/preview`：套用前回傳「不符合政策」與「會被擋在門外」的人數，前端據此確認。
6. **政策的預設**：沒有列時 `version = 1`，第一次 `PUT` 以 `version: 1` 建立（之後 `version` 從 2 開始）；`allowedMethods` 不接受空陣列（要全部就是 `null`）、
   必須啟用時「平台開放 ∩ 允許」不能是空的（`VALIDATION_FAILED`，`fields.allowedMethods = 'MFA_POLICY_NO_METHOD'`）。
7. **「不符合政策的人數」一次算完**：只看可登入、還沒設定的人（`users.mfa_enabled = false`），與「直接或經由群組（含巢狀）持有任一指定角色的人」取交集；
   持有者以 `AuthzService.usersInSubjectSets` 反向展開一次查出（與公告受眾同一個查詢）。原本逐人以 `listEffectiveRoles` 判斷，沒設定的人多時開頁與預覽都以秒計。
   登入時的單人判斷仍是 `MfaAvailability.isRequiredBy`（同一張關係圖）。
8. **`PLATFORM_MFA_METHODS` 在啟動時檢查**（`MfaAvailability.onApplicationBootstrap`）：env schema 不知道註冊表，方式全部登記之後才檢查。
9. **apps/platform 的方式名稱用 web-core 的註冊表**（`useMfaMethodUis` 的 `labelKey`），不另外維護 `MFA_METHOD_LABEL_KEY`；關閉前的確認框在 app 的 `core/mfa`（方式頁與租戶詳情共用，影響人數由呼叫端從 `apis/` 取得）。
10. **backstage 的 `user.listByMfa`／`user.listByMfaRole` route link**：安全性頁連到「不符合政策的人」的使用者列表——全員必須時 `?mfa=false&status=active`，
    只要求特定角色時再加 `roleId`（可多個）與 `includeGroupRoles=true`，與人數同一個判斷。
11. **權限的數量**：租戶目錄 53 → 55（文件的「共 52 項」原本就少算一項，一併改正）；平台 12 → 14。
12. **重設別人的 MFA 改成獨立的權限**（2026-10）：租戶 `user:resetMfa`、平台 `platformAdmin:resetMfa`，取代原本的 `user:update`／`platformAdmin:update`。
    `user:update` 不包含它（不是子能力）：重設 MFA 等於拆掉對方的第二道防線，比改名、停用的風險高，要能只給特定的人。預設的 `admin` 角色持有它，行為不變（既有租戶由租戶 migration 0043 補上，seed 不同步已存在的系統角色；0042 漏掉的 `mfaPolicy:read` 由 0044 補給 admin、auditor）；
    只有 `user:update` 的自訂角色在升級後失去重設的能力。租戶目錄 55 → 56、平台 14 → 15。

**M4（2026-10-09）：WebAuthn、簡訊、Telegram、LINE、平台參數**

1. **介面的補充**（都是選填，TOTP、Email 不必改）：`enrollSchema`（設定時的輸入）、`enrollChallenge`（`onRequest`：通訊軟體先綁定再發 challenge）、
   `MfaChallengeStart.publicData`（WebAuthn 的 options）、`MfaVerifyResult.factorUpdate`（設定確認時寫回公鑰或收件對象）、`MfaAccountContext.activeFactors`、
   `checkSettings`、`settings`；`assurance` 細分成四級。`modules/mfa` 的流程只多了套用 `factorUpdate`、`enrollSchema` 的驗證與 `onRequest` 的判斷。
2. **平台參數的入口在 `core/mfa`**（`MfaMethodSettings`，同 `MfaChallengeDelivery` 的 bind 做法）：方式與 `modules/tenant`（租戶層開關的檢查）都要讀，而它們不能依賴 `modules/mfa`。
3. **伺服器送出的驗證碼抽成 `core/mfa/otp-code.ts`**：簡訊與通訊軟體共用；Email 的實作沒改（行為相同，沒有必要動已上線的程式）。
4. **通訊軟體的模組自己有表**（平台 DB 的 `mfa_channel_links`）：D5 說的是「方式不直接查帳號表」，綁定是方式自己的資料；平台 migration 0025 同時建 `mfa_method_settings`。
5. **`…/mfa/verify` 的回應改成 union**（`MfaLoginVerifyResult`：resume 網址或設定的下一步），`SsoMfaEnrollNext` 加 `optional`。apps/platform 與 api 同一次部署（已是規則，§4）。
6. **`MfaPending` 加 `enroll`、`optional`、`amr`**；第二步通過後的轉換用條件式更新（`oidc_payloads.payload @> { next: 'mfa' }`），不是消耗再新增，併發的另一次驗證會拿到 `AUTH_MFA_PENDING_INVALID`。
7. **LINE 的簽章要原始本體**：只對 `/mfa-channels/line/webhook` 加保留原始本體的 body parser（與匯入的 body parser 同一個做法），不開全域的 `rawBody`。
8. **webhook 不走速率限制**（`@SkipThrottle()`）：供應商的少數 IP 會吃光一般的每 IP 額度。
9. **前端**：web-core 加 `EnrollStart`（簡訊的號碼）、`MfaEnrollFlow` 的 `onEnrollElsewhere`／`cancelLabel`、方式按鈕改成可換行（登入卡片窄時說明會溢出，瀏覽器驗證時發現）；
   apps/platform 的參數對話框依定義產生表單；backstage 的 SSO 設定搬到 `core/auth/sso.ts`（`features/account` 要發起「重新登入並新增」，feature 之間不能互相 import）。
10. **模擬服務**（`scripts/mock-messaging.ts`）同時是開發工具與整合測試的供應商：匯出 `startMockMessaging(port)`，直接執行時聽 :4466。


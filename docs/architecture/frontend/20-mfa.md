# 前端 20 — MFA

後端的規格（資料表、流程、端點、設計決策）在 [`../backend/21-mfa.md`](../backend/21-mfa.md)；這份只講前端怎麼接。

> 程式碼：`packages/web-core/src/mfa/`（註冊表、共用元件、內建方式的 UI）；apps/platform `features/login`（第二步）、`features/mfa-method`（平台開關與參數）、
> `features/tenant`（租戶詳情的「多重驗證」分頁）、`core/mfa`（關閉前的確認框）；backstage `features/security`（政策頁）、`features/user`（MFA 欄、篩選、重設）；
> 兩個 app 的 `features/account`（個人資料頁）；backstage `core/auth/sso.ts`（發起 SSO，含「重新登入並新增」）。

## 1. 方式的註冊表

每種驗證方式的 UI 是一筆 `MfaMethodUi`（`id`、`labelKey`、`descriptionKey`、`icon`、選填的 `EnrollStart`、`Enroll`、`Challenge`），以 api 的方式 id 對應。
兩個 app 在 `app/plugin.ts` 的同步階段依強度登記內建的 `webauthnMethod`、`totpMethod`、`smsMethod`、`telegramMethod`、`lineMethod`、`emailMethod`
（[`02-plugin-system.md`](./02-plugin-system.md) §6 的共同規則：重複登記丟例外）。

- `requireMfaMethod(id)`：程式內寫死的 id，沒登記是程式錯誤，丟例外。
- `useMfaMethodUi(id)`／`useMfaMethodUis()`：伺服器給的 id；沒登記時回 `undefined`——因子顯示「這個版本不支援」，第二步不列出它（只剩它時直接顯示備用碼）。
- `Enroll`／`Challenge` 以 `lazy()` 載入：`qrcode`（TOTP、通訊軟體的綁定）與 `@simplewebauthn/browser`（WebAuthn）只在方式的元件裡 `import()`，不進主要 bundle（`pnpm bundle:check`）。

方式的元件只負責「顯示伺服器給的資料、組出 payload」（TOTP：`{ code }`），送出、錯誤、限流的倒數由共用元件處理：

```ts
interface MfaEnrollStartProps { onStart(input); pending; error? }   // 開始設定前收集資料（簡訊的號碼）
interface MfaEnrollProps { enrollment; challenge; onSubmit(submission); onResend?; requesting?; pending; error? }
interface MfaChallengeProps { factor; challenge; onRequestChallenge?; requesting?; onSubmit(submission); pending; error? }
```

| 方式 | 設定 | 第二步 |
| --- | --- | --- |
| WebAuthn（`methods/webauthn`） | 取名 → 按下按鈕 `startRegistration(challenge.publicData.options)` → 送出回應；取消或逾時顯示可以重試，challenge 過期先重新取得 | 選到因子時先取得 challenge，再由使用者按下按鈕 `startAuthentication`（Safari 要求在點擊裡呼叫） |
| 簡訊（`methods/sms`） | `EnrollStart`：國碼（預設 886）＋ 國內號碼，`toE164` 去掉開頭的 0 → 開始設定時已送出 → 輸入碼 | 請伺服器送出 → 輸入碼（`shared/SentCodeChallenge`） |
| Telegram、LINE（`methods/messaging`） | 綁定的說明（QR code、在 App 開啟、手動傳送的綁定碼；LINE 先加好友）→「已完成綁定，傳送驗證碼」（還沒綁定時顯示 `MFA_CHANNEL_NOT_LINKED`）→ 輸入碼 | 同簡訊 |

`methods/shared/`：`SentCodeChallenge`、`SentCodeEnrollForm`（伺服器送出的碼，以字串前綴 `mfa.<id>.*` 換文字）、`useResendCountdown`、`useQrCode`。

WebAuthn 另外匯出 `authenticatePasskey(options)`、`supportsWebAuthn()`、`ceremonyErrorKey(error)`：apps/platform 互動頁的「使用通行金鑰登入」
（`features/login` 的 `usePasskeyLogin`、`PasskeyLoginButton`）以它們呼叫瀏覽器 API，取代密碼與第二步（[`../04-sso.md`](../04-sso.md) §3.6）。

## 2. 共用元件

web-core 不呼叫 app 的 API（[`17-shared-packages.md`](./17-shared-packages.md) §2）：元件收 app 給的函式。

| 元件 | 用在哪 | app 給什麼 |
| --- | --- | --- |
| `MfaChallengeForm` | apps/platform 互動頁的第二步 | `requestChallenge(factorId)`、`verify(factorId, submission)`、`onError`（第二步作廢 → 回到密碼） |
| `MfaEnrollFlow` | 互動頁的首次設定、帳號設定的「新增驗證方式」 | `start(method, input?)`、`confirm(factorId, submission)`、`resend(factorId)`、`onDone`；選填 `onEnrollElsewhere`（`enrollAt: 'idp'` 的方式改走別處）、`onCancel`／`cancelLabel`（互動中產品要求的設定是「略過」） |
| `MfaSecuritySection` | 兩個 app 的 `/profile` | `MfaSelfApi`（`overviewKey`、`fetchOverview`、`start`、`resend`、`confirm`、`remove`、`regenerate`、選填 `enrollElsewhere`；在各 app 的 `features/account/hooks/mfaSelfApi.ts`） |
| `MfaAccountStatusSection` | backstage 使用者詳情、apps/platform 平台管理者的編輯對話框 | `status`、`onReset`（沒有權限或是自己時不給） |
| `RecoveryCodesDialog` | 設定第一個因子、重新產生備用碼 | 碼只顯示這一次：複製、下載 `.txt`，勾「我已保存」才能關 |
| `PasswordConfirmDialog` | 移除驗證方式、重新產生備用碼 | 再輸入一次密碼 |

`MFA_RESTART_CODES`（`AUTH_MFA_TOO_MANY_ATTEMPTS`、`AUTH_MFA_PENDING_INVALID`、`AUTH_SSO_INTERACTION_INVALID`）：第二步已作廢，互動頁回到密碼步驟並顯示原因。

## 3. 各頁

- **互動頁**（apps/platform `/interaction/:uid`）：`POST …/login` 的回應是 `SsoLoginResult`。有 `redirectTo` 照舊頂層跳轉；有 `next` 時換成 `MfaStepPanel`
  （`next: 'mfa'` → `MfaChallengeForm`；`'mfaEnroll'` → `MfaEnrollFlow`，備用碼對話框的完成鈕是「繼續登入」，關掉才跳轉）。
  互動帶 `mfaEnroll`（backstage 要求新增安全金鑰，[`../backend/21-mfa.md`](../backend/21-mfa.md) §7.1）時先顯示「請先重新驗證身分」；`…/mfa/verify` 回傳設定的下一步時換成設定
  （`useMfaInteraction` 的 `onNext`），`optional` 的設定多一個「略過，直接登入」。
- **個人資料頁**（兩個 app）：「多重驗證」區塊（`MfaSecuritySection`）。backstage 選了安全金鑰時以 `redirectToSso('/profile', 租戶代碼, { prompt: 'login', mfa_enroll })` 頂層跳轉到帳號中心，完成後回到個人資料頁；
  apps/platform 的平台管理者直接設定。
- **backstage `/system/security`**：常駐的 feature `security`（不是可關閉的 feature），是系統設定的「安全性」分頁（[`02-plugin-system.md`](./02-plugin-system.md) §4.5）。`mfaPolicy:read` 進頁、`mfaPolicy:update` 才能改；
  儲存前 `POST /mfa/policy/preview`，會有人被要求設定或被擋在門外時先確認。「不符合政策的人數」連到使用者列表的 `?mfa=false`（route id `user.listByMfa`）。
- **backstage 使用者**：列表的「MFA」欄與篩選、詳情的驗證方式與「重設 MFA」（`user:resetMfa`，不能重設自己）。
- **apps/platform `/mfa-method`**：全平台開關（`mfaMethod:read` 進頁、`mfaMethod:update` 才能切換）；租戶詳情的 `?tab=mfa` 是租戶層開關（`tenant:update`）。
  關掉之前以 `GET /platform/mfa-methods/:id/impact` 顯示會被擋在門外的人數（`core/mfa/useConfirmMfaMethodOff`）。
  需要平台參數的方式有「參數」按鈕（`MfaMethodSettingsDialog`）：依 `settings.fields` 產生表單，有 `requiredWhen` 的欄位只在條件成立時顯示、送出時不帶隱藏的欄位；
  機密欄位顯示「已設定（留空沿用）」；欄位與整體的檢查錯誤翻成 `mfa.settings.error.<代碼>`（標籤與說明在 web-core 的 `mfa.method.<id>.settings.<key>`）。
  參數沒有填齊時標示「尚未設定參數」，「全平台開啟」與租戶詳情的「開」不能選（[`../backend/21-mfa.md`](../backend/21-mfa.md) §5.1）。

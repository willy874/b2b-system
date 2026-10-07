# 前端 20 — MFA

後端的規格（資料表、流程、端點、設計決策）在 [`../backend/21-mfa.md`](../backend/21-mfa.md)；這份只講前端怎麼接。

> 程式碼：`packages/web-core/src/mfa/`（註冊表、共用元件、內建方式的 UI）；apps/platform `features/login`（第二步）、`features/mfa-method`（平台開關）、
> `features/tenant`（租戶詳情的「兩步驟驗證」分頁）、`core/mfa`（關閉前的確認框）；backstage `features/security`（政策頁）、`features/user`（MFA 欄、篩選、重設）；
> 兩個 app 的 `features/account`（個人資料頁）。

## 1. 方式的註冊表

每種驗證方式的 UI 是一筆 `MfaMethodUi`（`id`、`labelKey`、`descriptionKey`、`icon`、`Enroll`、`Challenge`），以 api 的方式 id 對應。
兩個 app 在 `app/plugin.ts` 的同步階段登記內建的 `totpMethod`、`emailMethod`（[`02-plugin-system.md`](./02-plugin-system.md) §6 的共同規則：重複登記丟例外）。

- `requireMfaMethod(id)`：程式內寫死的 id，沒登記是程式錯誤，丟例外。
- `useMfaMethodUi(id)`／`useMfaMethodUis()`：伺服器給的 id；沒登記時回 `undefined`——因子顯示「這個版本不支援」，第二步不列出它（只剩它時直接顯示備用碼）。
- `Enroll`／`Challenge` 以 `lazy()` 載入：`qrcode` 只在 `TotpEnroll` 裡 `import()`，不進主要 bundle（`pnpm bundle:check`）。

方式的元件只負責「顯示伺服器給的資料、組出 payload」（TOTP：`{ code }`），送出、錯誤、限流的倒數由共用元件處理：

```ts
interface MfaEnrollProps { enrollment; challenge; onSubmit(submission); onResend?; pending; error? }
interface MfaChallengeProps { factor; challenge; onRequestChallenge?; requesting?; onSubmit(submission); pending; error? }
```

## 2. 共用元件

web-core 不呼叫 app 的 API（[`17-shared-packages.md`](./17-shared-packages.md) §2）：元件收 app 給的函式。

| 元件 | 用在哪 | app 給什麼 |
| --- | --- | --- |
| `MfaChallengeForm` | apps/platform 互動頁的第二步 | `requestChallenge(factorId)`、`verify(factorId, submission)`、`onError`（第二步作廢 → 回到密碼） |
| `MfaEnrollFlow` | 互動頁的首次設定、帳號設定的「新增驗證方式」 | `start(method)`、`confirm(factorId, submission)`、`resend(factorId)`、`onDone` |
| `MfaSecuritySection` | 兩個 app 的 `/profile` | `MfaSelfApi`（`overviewKey`、`fetchOverview`、`start`、`resend`、`confirm`、`remove`、`regenerate`；在各 app 的 `features/account/hooks/mfaSelfApi.ts`） |
| `MfaAccountStatusSection` | backstage 使用者詳情、apps/platform 平台管理者的編輯對話框 | `status`、`onReset`（沒有權限或是自己時不給） |
| `RecoveryCodesDialog` | 設定第一個因子、重新產生備用碼 | 碼只顯示這一次：複製、下載 `.txt`，勾「我已保存」才能關 |
| `PasswordConfirmDialog` | 移除驗證方式、重新產生備用碼 | 再輸入一次密碼 |

`MFA_RESTART_CODES`（`AUTH_MFA_TOO_MANY_ATTEMPTS`、`AUTH_MFA_PENDING_INVALID`、`AUTH_SSO_INTERACTION_INVALID`）：第二步已作廢，互動頁回到密碼步驟並顯示原因。

## 3. 各頁

- **互動頁**（apps/platform `/interaction/:uid`）：`POST …/login` 的回應是 `SsoLoginResult`。有 `redirectTo` 照舊頂層跳轉；有 `next` 時換成 `MfaStepPanel`
  （`next: 'mfa'` → `MfaChallengeForm`；`'mfaEnroll'` → `MfaEnrollFlow`，備用碼對話框的完成鈕是「繼續登入」，關掉才跳轉）。
- **個人資料頁**（兩個 app）：「兩步驟驗證」區塊（`MfaSecuritySection`）。
- **backstage `/security/mfa`**：常駐的 feature `security`（不是可關閉的 feature），分頁式容器；MFA 是第一個分頁。`mfaPolicy:read` 進頁、`mfaPolicy:update` 才能改；
  儲存前 `POST /mfa/policy/preview`，會有人被要求設定或被擋在門外時先確認。「不符合政策的人數」連到使用者列表的 `?mfa=false`（route id `user.listByMfa`）。
- **backstage 使用者**：列表的「MFA」欄與篩選、詳情的驗證方式與「重設 MFA」（`user:update`，不能重設自己）。
- **apps/platform `/mfa-method`**：全平台開關（`mfaMethod:read` 進頁、`mfaMethod:update` 才能切換）；租戶詳情的 `?tab=mfa` 是租戶層開關（`tenant:update`）。
  關掉之前以 `GET /platform/mfa-methods/:id/impact` 顯示會被擋在門外的人數（`core/mfa/useConfirmMfaMethodOff`）。

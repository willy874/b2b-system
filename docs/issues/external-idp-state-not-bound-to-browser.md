# 外部 IdP 登入的 state／ticket 沒有綁定發起登入的瀏覽器

## 現況

外部 IdP 登入（[`04-sso.md`](../architecture/04-sso.md) §3.3）全程以 `state` 串接，但 `state` 不綁定發起登入的瀏覽器，而且完成互動用的 `ticket` 就等於 `state`。

`apps/api/src/modules/auth/external-login.service.ts`：

- `start()`（L88–119）產生 `state` 並把含有 `state` 的外部授權網址回給呼叫者（互動頁）。`state`／`nonce`／PKCE verifier／互動 id／租戶 id 存進 `oidc_payloads`（`ExternalLogin`，10 分鐘）。
- `callback()`（L128–140）只用 `state` 找回登入狀態（L129），**不檢查任何 cookie**；固定的 callback 不在任何租戶網域上，是 `@Public()`。兌換、對應帳號後把 `accountId` 寫回同一個 `state`（L195–199）。
- 完成互動的網址帶 `ticket=<state>`（L200），`ticket` 直接重用 `state`：

```ts
const ticket = new URLSearchParams({ ticket: state });
return `${this.apiBase}/oidc-interaction/${pending.interactionUid}/external/complete?...`;
```

- `complete()`（L207–225）只檢查三件事：`ticket` 找得到且已有 `accountId`、`interactionUid` 相符、請求帶著該互動的 cookie（L214、L217）。`ticket` 與 accountId 的對應是在 `callback()` 裡用「跳回 callback 的那個瀏覽器」驗證的身分，但 `complete()` 不要求是同一個瀏覽器。

因為 `callback()` 不把「在外部 IdP 完成驗證的瀏覽器」綁到登入流程上，而 `ticket` 又是發起者一開始就知道的 `state`，所以發起互動的人與在外部 IdP 驗證的人可以是不同的人（登入 CSRF／session fixation）。

重現：

1. 發起者在自己的瀏覽器開啟租戶 T 的 `/oidc/auth`，取得互動 X 與它的 cookie。
2. 發起者呼叫 `POST /oidc-interaction/X/external`，拿到外部 IdP 的授權網址（內含 `state` S）。
3. 受害者的瀏覽器在外部 IdP 完成驗證、跳回固定的 callback；`callback()` 兌換授權碼、對應到受害者的帳號，把受害者的 `accountId` 寫進 S。受害者自己的 `complete` 因為沒有互動 X 的 cookie 而停在錯誤頁，`ticket` 未被消耗。
4. 發起者帶著互動 X 的 cookie 與已知的 `ticket=S` 呼叫 `GET /oidc-interaction/X/external/complete`，完成互動、經 resume 與 BFF 取得受害者的 app session。

## 影響

- 前提：租戶有啟用中的外部 IdP 連線（feature `identityProvider`）；發起者能讓受害者在該外部 IdP 完成一次登入（已登入並同意過時只需一次點擊）。發起者在租戶內不需要任何帳號。
- 受害者範圍（`resolveAccount`，L243–320）：
  - 已連結外部身分 `(provider, subject)` 的帳號，包含 super-admin、admin；
  - email 網域登記在該連線、且沒有 `member` 以外系統角色的帳號（會自動連結）；
  - `auto_create` 連線（會建立並登入新帳號）。
- 結果是取得受害者身分的完整 app session。只要外部 IdP 連線存在就受影響。

## 修正方式

擇一或並用：

1. **把流程綁到發起登入的瀏覽器**（建議）：`start()` 設一個 host-only、`HttpOnly`、`SameSite=Lax` 的綁定 cookie（path 設成固定 callback 的路徑），在 `ExternalLogin` 存它的雜湊；`callback()` 在兌換授權碼 **之前** 先比對這個 cookie，對不上就拒絕（回錯誤頁、不寫 `accountId`）。這是 state 必須綁定使用者代理的標準要求（OIDC／RFC 9700）。
2. **ticket 與 state 脫鉤**：`callback()` 成功後另外產生一個隨機 `ticket`（只存雜湊），不要沿用 `state`，讓發起者無法事先知道完成互動要用的值。

兩者都做可同時擋住「別人的瀏覽器完成驗證」與「發起者用已知值完成互動」。

## 驗證方式

`apps/api/test/sso-external.spec.ts`：

- 補案例：不帶綁定 cookie（或帶別的互動的 cookie）打固定 callback → 進錯誤頁，`oidc_payloads` 的該筆不應寫入 `accountId`。
- 補案例：發起互動 X 的人拿 `state` 直接打 `complete` → 回 `AUTH_SSO_EXTERNAL_FAILED`。
- 既有的 `loginExternally` 輔助函式要改成帶上 `start()` 設的綁定 cookie，原本的正常流程才會過。

相關規格：[`04-sso.md`](../architecture/04-sso.md) §3.3、§12.2 D8。

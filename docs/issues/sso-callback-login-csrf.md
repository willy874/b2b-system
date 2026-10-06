# `/auth/sso/callback` 接受跨站表單送出：受害者可能被登入成攻擊者

## 現況

後端：

- `apps/api/src/modules/auth/auth.controller.ts` 的 `ssoCallback()`（L163–183）：
  - 標了 `@Public()`；
  - 成功後由 `respondWithSession()`（L215–226）設定 refresh cookie（`SameSite=Lax`、`Path=/api/auth`）；
  - 不檢查自訂標頭、`Origin` 或 `Content-Type`。
- `apps/api/src/modules/auth/platform-auth.controller.ts` 的 `ssoCallback()`（L46–63）相同。
- Nest 預設的 body parser 除了 JSON 還有 urlencoded：`@nestjs/platform-express` 的 `ExpressAdapter.registerParserMiddleware()` 註冊 `express.urlencoded({ extended: true })`。
  - 所以 HTML 表單送出的 `application/x-www-form-urlencoded` 一樣會解析成 `{ code, codeVerifier, clientId, redirectUri }`，並通過 `SsoCallbackSchema`。
- 兌換時的檢查，用到的值全部由送出的人提供：
  - 授權碼本身：`oidc-provider.service.ts` 的 `redeemAuthorizationCode()`（L317 起），檢查沒用過、client、redirect URI、PKCE；
  - 租戶相符：`sso.service.ts` 的 `callback()`（L126–133）。
- `DIRECT_LOGIN_ENABLED` 打開時，`POST /auth/login`（`auth.controller.ts` L50–67）有同樣的問題：攻擊者把自己的帳密放進表單即可。production 預設關閉（`auth.service.ts` L99–108）。
- [`backend/04-auth.md`](../architecture/backend/04-auth.md) §2.5 寫「`/auth/refresh` 是唯一靠 cookie 認證的端點，因此是唯一的 CSRF 標的」，所以只有 refresh 要求 `x-refresh-request: 1`。會「設定」cookie 的登入端點不在考慮範圍內。

前端放大了影響（`packages/web-core/src/auth/SessionStore.ts`）：

- `applyTokens()`（L142–149）採用續期結果時，不比對新 token 的 `sub`、`tid` 是否和目前的身分相同。
- 其他分頁送來的 `refresh-done`（L98–101）也直接套用。
- 所以 refresh cookie 被換成別人的 refresh 家族之後，受害者的分頁會無聲地換成攻擊者的身分，並廣播給所有分頁。

攻擊步驟。前提是攻擊者在同一個租戶有帳號。

1. 攻擊者用自己的帳密走一次授權流程：apps/platform 網域上的 `/api/oidc/auth?client_id=backstage&tenant=acme&redirect_uri=https://acme.example.com/auth/callback&code_challenge=…`。
   - 從最後的轉址取出 `code`，自己保留 `code_verifier`，不讓瀏覽器去兌換。
2. 授權碼只有 60 秒有效（`OIDC_TTL.AuthorizationCode`）。攻擊者的頁面在這段時間內自動送出表單：

   ```html
   <form method="POST" action="https://acme.example.com/api/auth/sso/callback">
     <input name="code" value="…" />
     <input name="codeVerifier" value="…" />
     <input name="clientId" value="backstage" />
     <input name="redirectUri" value="https://acme.example.com/auth/callback" />
   </form>
   ```

3. 這是頂層的跨站 POST 導覽。`SameSite` 只限制送出 cookie，不限制頂層導覽的回應設定 cookie。
   - 所以 `Set-Cookie: refresh_token=<攻擊者的 refresh 家族>` 會被存下，蓋掉受害者原本的 refresh cookie。
4. 受害者下一次續期（access token 每 5 分鐘）就拿到攻擊者的 session。`SessionStore` 直接採用，並廣播到所有分頁。

## 影響

- 受害者以為還在用自己的帳號，之後的操作都落在攻擊者的帳號裡：
  - 檔案上傳到「自己的」個人資料夾；
  - 建立個人 API token；
  - 填寫的資料。
- 攻擊者事後登入自己的帳號就看得到這些內容。
- 前提：
  - 攻擊者在同一個租戶有帳號。別的租戶的授權碼會被 `sso.service.ts` 擋下。
  - 攻擊者能誘使受害者打開一個頁面。
- 平台端的 `/platform/auth/sso/callback` 要求攻擊者自己是平台管理者，影響很小，但修法相同。

## 修正方式

1. 後端是主要修正：會設定 session cookie 的公開端點要拒絕跨站送出。
   - 套用範圍：`POST /auth/sso/callback`、`POST /platform/auth/sso/callback`、`POST /auth/login`。
   - 擇一，建議 a：
     - a. 比照 refresh 要求自訂標頭，例如沿用 `x-refresh-request: 1`，或另取一個名稱。帶自訂標頭的跨站請求會觸發 preflight，api 不回 CORS，preflight 就過不了。
     - b. 只接受 `Content-Type: application/json`，其他回 415。注意不能全域關掉 urlencoded，`/oidc/token` 需要它。
     - c. 要求 `Sec-Fetch-Site: same-origin`；沒有這個標頭時，退回比對 `Origin` 的 host 與請求的 host。
2. 前端帶上 1.a 的標頭：
   - `apps/backstage/src/apis/auth/sso-callback/fetcher.ts`；
   - `apps/platform/src/apis/auth/sso-callback/fetcher.ts`；
   - 呼叫 `POST /auth/login` 的測試與腳本。
3. 前端的縱深防禦：`SessionStore` 的 `applyTokens()` 與 `refresh-done` 處理加一道檢查。
   - 已經有身分時，解碼新 access token 的 payload（不驗簽），比對 `sub` 與 `tid`。
   - 不同就視同換人：`endSession('identity_changed')`、清掉查詢快取、回到登入頁。
4. 更新文件，CSRF 的標的除了 refresh，還要加上會設定 cookie 的登入端點：
   - [`backend/04-auth.md`](../architecture/backend/04-auth.md) §2.5；
   - [`01-system.md`](../architecture/01-system.md) §6 的 CSRF 那一列。

## 驗證方式

- `apps/api/test/sso.spec.ts`：
  - 以 `application/x-www-form-urlencoded`，或不帶新標頭，送出 `POST /auth/sso/callback`：回 4xx，而且回應沒有 `Set-Cookie`；
  - 原本的 JSON 加標頭流程照常成功。
- 平台端在對應的平台測試補同樣的兩個案例。
- `packages/web-core/src/auth/__tests__/SessionStore.test.ts`：
  - 續期回來的 token `sub` 不同 → session 結束（`identity_changed`），不套用新 token；
  - 其他分頁的 `refresh-done` 帶來不同的 `sub` → 同樣結束；
  - 原本沒有身分（剛登入）時正常套用。

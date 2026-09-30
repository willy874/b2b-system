# 服務帳號／API Token

- 優先度：P2
- 狀態：提案
- 依賴：—
- 相關：[`webhooks.md`](./webhooks.md)（接收端回查）、[`overview/03-roadmap.md`](../overview/03-roadmap.md)「Phase 1 之後」第 8 項、
  [`backend/04-auth.md`](../architecture/backend/04-auth.md)、[`rbac/01-domain-model.md`](../rbac/01-domain-model.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

API 目前只認 access token（HS256 JWT，5 分鐘，帶 `tid`），而取得 access token 的方式有兩種：

- 瀏覽器走 OIDC 登入互動（[`../architecture/04-sso.md`](../architecture/04-sso.md) §3.1）
- **直接 `POST /auth/login` 用 email ＋ 密碼換**，文件註明「保留給 API 測試與腳本」（`auth.controller.ts`）

CI、美術工具的匯入腳本、遊戲建置流程現在只能走第二條：拿真人帳號的密碼、每 5 分鐘續期一次。
密碼外流等於帳號外流、稽核分不出是人還是程式，之後若做 [MFA](./mfa.md)，這條路還會直接斷掉。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 個人存取 token（代表自己；權限 ≤ 本人） | OAuth2 client credentials（oidc-provider 支援，但要另外管 client） |
| 服務帳號（租戶內的非人類帳號，指派角色） | token 的 IP 白名單 |
| token 建立時只顯示一次，資料庫只存雜湊 | 平台管理者（apps/auth）的 token |
| 到期時間（必填、有上限）、最後使用時間、撤銷 | WebSocket 用 API token 連線 |
| token 以 **租戶** 為界：只在發出它的租戶網域有效 | |
| 服務帳號的管理頁、個人 token 的管理頁（帳號設定） | |

## 初步構想

### 資料模型（租戶 DB）

- **服務帳號是 `users` 的一種**：加 `kind`（`human` ｜ `service`）。服務帳號沒有密碼、不能走登入互動、不能連結外部身分、
  不收信；角色、權限快取（`{tenantId}:{userId}`）、稽核的 `actor_id` 全部沿用。
  - [`rbac/01-domain-model.md`](../rbac/01-domain-model.md) 目前建議另一張 `service_accounts` 表，以新的主體型別持有角色（`role:<id>#holder@serviceAccount:<id>`），兩者要擇一（開放問題 1）。
- `api_tokens`：`id`、`user_id`（本人或服務帳號）、`name`、`prefix`（顯示用的前幾碼）、`secret_hash`、`permissions`（null＝跟著帳號）、
  `expires_at`、`last_used_at`、`revoked_at`、`created_by`。

### 驗證

- 格式：`Authorization: Bearer b2bt_<tokenId>_<secret>`。前綴和 JWT（`eyJ` 開頭）不會撞。
- **`AccessTokenVerifier` 是唯一的入口**（HTTP guard、WebSocket 都用它），在這裡依前綴分流：
  - 查 `api_tokens`（以 `tokenId` 找、比雜湊；可以快取幾秒，撤銷時失效），檢查未撤銷、未過期、帳號 `active`、未刪除
  - token 本身就在租戶 DB，所以天然只在那個租戶的網域有效，不需要 `tid`
  - 產生的 `AuthUser` 帶 `tokenId`；權限＝帳號權限 ∩ token 的 `permissions`
- 反提權：建立 token 時勾選的權限必須 ⊆ 建立者目前的權限；服務帳號的角色指派沿用既有的 `assertGrantable`。
- `last_used_at` 不每次寫：記在記憶體，每分鐘批次更新。

### 速率限制與稽核

- `RateLimitGuard` 的 `principalOf` 加一種主體：`t:{tenantId}:token:{tokenId}`（不依 IP、也不和本人的瀏覽器共用額度）。
- 稽核：`actor_id` 是帳號（本人或服務帳號），`metadata.tokenId` 記是哪一把 token。現在的稽核表沒有「主體類型」欄，
  是否要加見開放問題 3。
- 建立、撤銷 token 寫稽核（`apiToken.create`、`apiToken.revoke`）；服務帳號的建立、停用、刪除照使用者的稽核。

### 權限

- `serviceAccount:read`、`serviceAccount:create`、`serviceAccount:update`、`serviceAccount:delete`（管理服務帳號與它的 token）
- 個人 token：`@Authenticated()` 管自己的；管理者撤銷別人的 token 用 `user:update`

### 直接登入端點

- 有了 token 之後，`POST /auth/login` 可以改成只在非 production 開放（或完全移除），腳本一律改用 token。

## 開放問題

1. 服務帳號用 `users.kind`，還是照 `rbac/01-domain-model.md` 另開 `service_accounts` 表？
   前者沿用快取與稽核最省事，但使用者列表、人數統計、「最後一位 super-admin」等判斷都要排除服務帳號。
2. 個人 token 要限縮權限範圍（scope），還是一律等於本人權限？
3. 稽核要不要加 `actor_type`（`user` ｜ `service` ｜ `token` ｜ `system`）？加的話要動熱表、冷表與封存函式。
4. 服務帳號屬於誰？建立者離職（帳號停用或刪除）時，服務帳號與它的 token 要怎麼處理？
5. `POST /auth/login` 在 token 上線後要保留到什麼程度？

## 歸檔去向

- `docs/adr/NNNN-api-tokens.md`
- `docs/architecture/backend/04-auth.md` 新增章節、`docs/rbac/01-domain-model.md`、`docs/rbac/02-permission-catalog.md`

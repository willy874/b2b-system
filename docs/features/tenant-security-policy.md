# 租戶安全政策（IP 允許清單、登入中的裝置、閒置逾時）

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`mfa.md`](./mfa.md)（MFA 另一份提案，兩者都是企業客戶的安全需求）、[`backend/04-auth.md`](../architecture/backend/04-auth.md)（refresh token 家族、`token_version`）、
  [`04-sso.md`](../architecture/04-sso.md) §3、§12 D5（單一登出、IdP session）、[`06-external-api.md`](../architecture/06-external-api.md) §9.4（token 的 IP 白名單列為不做）、
  [`backend/12-settings.md`](../architecture/backend/12-settings.md)（帳號政策）、[`05-tenancy.md`](../architecture/05-tenancy.md) §5.3（`rateLimit.trustedCidrs`）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

企業客戶上線前的安全問卷，除了 MFA（[`mfa.md`](./mfa.md)）之外，常見的還有：

- **限制來源 IP**：後台只允許公司網段或 VPN。現在只能在 WAF 做（[`05-tenancy.md`](../architecture/05-tenancy.md) §2、[`06-external-api.md`](../architecture/06-external-api.md) D9），租戶無法自己設定；
  `rateLimit.trustedCidrs` 只放寬限流，不是限制。API token 的 IP 白名單已列為「之後可以在 `api_tokens` 加欄位」。
- **看得到自己登入了哪些裝置，並能個別登出**：現在只有「登出目前這個 IdP session」（單一登出，不遞增 `token_version`），
  或重設密碼時 `token_version + 1` 讓 **所有** 裝置登出（[`iam/03-flows.md`](../architecture/iam/03-flows.md)）。沒有裝置清單，也不能只登出某一台。
- **閒置逾時**：refresh token 的壽命是固定的；客戶要求「閒置 30 分鐘自動登出」。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 租戶的 IP 允許清單：登入與 backstage 的 API 請求；super-admin 的緊急例外（見開放問題 1） | 依角色或依使用者的 IP 規則 |
| API token 的 IP 允許清單（每個 token 一組，對外 API 檢查） | 地理位置封鎖 |
| 個人帳號頁「登入中的裝置」：瀏覽器、IP、最後活動時間；個別登出、登出其他全部 | 裝置信任、記住此裝置 |
| 租戶管理者可以查看並強制登出某位使用者的所有 session | |
| 閒置逾時（系統設定）：超過時間沒有續期就讓家族失效 | |

## 使用者故事

**作為使用者，我希望看到自己目前在哪些裝置登入並登出遺失的那台，以便筆電遺失時保護帳號。**

- **Given** 我在公司電腦與家裡的筆電都登入了
- **When** 我在「登入中的裝置」對筆電按「登出」
- **Then** 筆電的 refresh 家族被撤銷、它的分頁收到推播回到已登出頁；公司電腦不受影響

**作為租戶管理者，我希望後台只允許公司網段登入，以便帳密外洩也無法從外部使用。**

- **Given** 我把允許清單設為 `203.0.113.0/24`
- **When** 有人從其他 IP 輸入正確的帳密
- **Then** 登入被拒絕並寫稽核 `auth.ipDenied`；已登入的 session 在下一次請求時被拒絕

## 初步構想

- 裝置：`refresh_tokens` 已有 `family_id`；加（或另一張表）家族的 `user_agent`、`ip`、`created_at`、`last_used_at`。撤銷單一家族沿用現有的 `revoked_at` 與 `SESSIONS_REVOKED` 推播。
- IP 允許清單：系統設定（字串，與 `rateLimit.trustedCidrs` 同一種格式）或 feature 參數，見開放問題 2；檢查放在租戶請求的 guard 與登入互動。
  依 `X-Forwarded-For` 判斷，要與 nginx 的信任代理設定一致。
- API token：`api_tokens` 加 `allowed_cidrs`；對外 API 程序驗證 token 後檢查。
- 閒置逾時：續期時比較 `last_used_at`；系統設定 `auth.idleTimeoutMinutes`（0 = 不啟用）。
- 權限：個人裝置只要登入；強制登出他人 `user:revokeSessions`（新增，或併入 `user:update`）；IP 清單 `system:update`。
- 稽核：`auth.sessionRevoke`、`auth.ipDenied`、設定變更照系統設定的稽核。

## 開放問題

1. IP 清單設錯會把所有人（包含設定的人）鎖在外面。要不要 super-admin 例外、或由平台管理者解除？
2. IP 清單放系統設定（租戶自己改）還是 feature 參數（只有平台改）？
3. 外部 IdP 登入要不要也套用 IP 清單（IdP 自己可能已經有條件式存取）？
4. 「登入中的裝置」要不要包含 apps/platform 的平台管理者？
5. 與 [`mfa.md`](./mfa.md) 要不要合成一個「安全政策」設定頁？

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

- `docs/architecture/backend/04-auth.md`（新增章節）、`docs/architecture/06-external-api.md`（token 的 IP 清單）

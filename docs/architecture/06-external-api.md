# 對外 API（給外部系統的獨立入口）

決定與理由見 [ADR-0027](../adr/0027-api-tokens-external-api.md)（D9～D19）。這份文件描述做出來的樣子：程序與部署、
請求怎麼找到租戶與認人、路由的分界、限流、文件。token 的建立與管理見 [`backend/04-auth.md`](./backend/04-auth.md) §8.2。

## 1. 全貌

```
  整合方（CI、建置流程、外部系統）
      │  Authorization: Bearer b2bt_<租戶代碼>_<tokenId>_<secret>
      ▼
  api.example.com ─▶ external-gateway（nginx :8082）─▶ external-api（:3001，main.external.ts）
                     network: external                    │  networks: external, data, storage
                                                          ├─▶ 平台 DB（租戶登記、廣播）
                                                          └─▶ 租戶 DB（由 token 的租戶代碼決定）

  租戶網域 ─▶ backstage（nginx）─▶ api（:3000，main.ts）     ← 內部 api，與上面互不接受對方的憑證
```

- **同一份程式、另一個程序**：`apps/api` 的第二個進入點 `src/main.external.ts`，根模組 `src/external-api.module.ts`。
  業務邏輯、稽核、權限檢查與內部 api 是同一份 service。
- **只認 API token**（D10）：不讀 cookie、不接受 JWT access token；內部 api 也一律拒絕 `b2bt_` 開頭的 token
  （`AccessTokenVerifier.verifyClaims`）。
- **沒有** Socket.io、OIDC Provider、refresh cookie、CSRF；不 import `RealtimeModule`、`AuthModule`。
- **只入列、不執行背景工作**（D19）：`src/external-process-env.ts` 在任何模組讀設定之前把 `JOBS_WORKER_ENABLED` 設成 `false`。
- **跨程序的一致性**：這個程序寫入的資料，快取失效與推播都經平台 DB 的廣播送到內部 api（[`01-system.md`](./01-system.md) §4.4）。

## 2. 一個請求的流程

| 順序 | 元件 | 做什麼 |
| --- | --- | --- |
| 1 | `RequestIdMiddleware` | 與內部 api 相同 |
| 2 | `TokenTenantMiddleware` | 解析 token 的租戶代碼 → `TenantDirectory.findByCode` → `Tenancy.enter`。不看網域：全平台只有一個對外網域（D9）。代碼只是「去哪裡找」的提示，改代碼換不到別的租戶 |
| 3 | `SurfaceGuard` | 內部的路由回 `404 NOT_FOUND`（§3） |
| 4 | `ApiTokenAuthGuard` | `ApiTokenVerifier`：格式 → 租戶相符 → 以 id 找（快取 10 秒）→ 比對 `SHA-256(secret)`（定長比較）→ 未撤銷、未過期 → 帳號有效且 `token_version` 沒變（使用者快取）。成功時把 token 寫進請求脈絡、記下使用（§5）；失敗以 IP 計數（§4） |
| 5 | `ExternalRateLimitGuard` | 以 token 計數（§4） |
| 6 | `FeatureGuard`、`PermissionsGuard` | 與內部 api 相同 |

**錯誤**：沒帶、格式不對、找不到、雜湊不符、已撤銷都回 `401 AUTH_TOKEN_INVALID`（不透露 token id 是否存在）；
過期 `401 AUTH_API_TOKEN_EXPIRED`；帳號的 `token_version` 變了 `401 AUTH_TOKEN_STALE`；帳號停用 `403 AUTH_ACCOUNT_DISABLED`。
錯誤信封與內部 api 相同（`{ error: { code, message, details? } }`）。

**權限**（D3）：token 的 `scopes` 寫進請求脈絡（`setContextApiToken`）。`PermissionService.getPermissionSet` 問的是 token 的擁有者時，
回傳 **帳號的權限 ∩ scopes 的閉包**（super-admin 也只剩 scopes），所以 guard 與 service 裡的權限判斷都套得到。
快取存的是帳號本身的權限，同一個人在內部 api 的請求不受影響。資料夾等資源上的能力跟著帳號，不在 scope 裡。

## 3. 路由的分界（`@ExternalApi()`、`SurfaceGuard`）

兩個程序都會註冊 import 進來的模組的 **全部** controller（Nest 的 controller 跟著 module），以 metadata 分開：

| 標記 | 路徑 | 宣告 | 在哪個程序 |
| --- | --- | --- | --- |
| 沒標（`internal`） | 不能在 `/v<n>/` 底下 | 任何 | 內部 api |
| `@ExternalApi()`（class） | 一律在 `/v<n>/` 底下 | `@Authenticated` 或 `@RequirePermissions`（不能 `@Public`、不能是平台端點） | 對外 API |
| `@Surface('both')` | — | 只能 `@Public` | 兩邊（目前只有 `/health`） |

規則由 `common/route-audit.ts` 在啟動時檢查（違反就啟動失敗），清單在 `test/route-audit.spec.ts`。
對外的 controller 與 DTO 放在 `modules/<name>/external/`；DTO 與內部的分開，內部改欄位不會改到對外契約。

**目前的對外端點**：`GET /v1/me`（這把 token 的帳號、token 的資訊、實際取得的權限）、`GET /health`、`GET /health/ready`。

## 4. 速率限制（D13）

| 桶 | key | 上限（次／分） |
| --- | --- | --- |
| 每把 token | `x:{tenantId}:token:{tokenId}` | `EXTERNAL_RATE_LIMIT`（預設 600） |
| 每個 IP 的驗證失敗 | `externalAuthFailure:{ip}` | `EXTERNAL_AUTH_FAILURE_RATE_LIMIT`（預設 30）；超過之後的失敗回 `429`，成功的請求不計 |
| 沒有 token 的請求（健康檢查） | IP | `ANONYMOUS_RATE_LIMIT` |

每個整合有自己的額度，不和本人的瀏覽器、也不和同一個 NAT 後面的其他整合共用。計數在程序的記憶體（共享計數見
[`../features/multi-instance.md`](../features/multi-instance.md)）。

## 5. 快取與最後使用時間

- **token 的驗證快取**（`ApiTokenCacheService`，D17）：以「租戶 × token id」快取 10 秒。撤銷在內部 api 發生，交易後失效並經頻道
  `api_token_cache` 廣播，對外 API 立即拒絕；漏掉廣播時最多 10 秒。帳號的停用與 `token_version` 由使用者快取負責（`user_cache`）。
- **`last_used_at`**（`ApiTokenUsageService`，D8）：記在記憶體，每分鐘依租戶批次更新一次；程序結束前再寫一次。

## 6. 部署與開發

| | 開發 | Production（`docker-compose.prod.yml`） |
| --- | --- | --- |
| 啟動 | `pnpm dev:external-api`（`node --watch` ＋ swc，不跑第二個 `nest --watch`） | 服務 `external-api`：同一個映像，`node dist/src/main.external.js` |
| port | `EXTERNAL_API_PORT`（預設 3001） | 容器內 3001；閘道 `external-gateway`（nginx，`deploy/nginx.external-api.conf`）對外 8082 |
| 網路 | — | `external`（閘道 ＋ external-api）、`data`、`storage`；閘道碰不到內部 api |
| 環境變數 | 與 api 共用 `.env` | 沿用 api 的 environment（YAML merge），另外覆寫連線池（`EXTERNAL_TENANT_POOL_MAX`、`EXTERNAL_PLATFORM_POOL_MAX`）、heap、限流 |
| 健康檢查 | `GET /health` | compose 的 healthcheck 打 `:3001/health`（映像的 HEALTHCHECK 是 api 的 :3000） |

- 連線預算：每個程序都有自己的平台池與租戶池，公式要把這個程序算進去（[`backend/02-database.md`](./backend/02-database.md) §6.2）。
- nginx 閘道：只有一個 `location /`，`client_max_body_size 1m`（檔案以 presigned URL 直傳租戶網域的 `/storage`），
  `Cache-Control: no-store`、HSTS、`nosniff`。`sh deploy/check-nginx.sh` 一併檢查它。

## 7. 文件（OpenAPI）

`pnpm --filter @b2b-system/api openapi:generate` 從同一個 app 產生兩份（`src/swagger.ts`，以路徑分開）：

| 檔案 | 內容 | 用途 |
| --- | --- | --- |
| `apps/api/openapi.json` | `/v<n>/` 以外的路由；拿掉只有對外路由引用的 schema | 產生前端 SDK（`pnpm sdk:generate`） |
| `apps/api/openapi.external.json` | `/v<n>/*` 與 `/health*`；只留引用得到的 schema | 給整合方 |

非 production 時，兩個程序都在 `/docs` 提供自己的文件。

**契約的版本**（D12）：v1 之內只能 **加** 欄位與端點；改名、刪除、改語意要開 v2，與 v1 並存至少 6 個月。

## 8. 測試

| 層 | 涵蓋 |
| --- | --- |
| 單元 | token 格式（`common/auth/__tests__/api-token.format.spec.ts`） |
| 整合 | `test/external-api.spec.ts`：同一個測試程序裡起內部 api 與對外 API 兩個 app。`/v1/me`、各種無效 token、JWT 與 API token 互不通用、`SurfaceGuard` 的兩個方向、scope 的交集、在內部 api 撤銷或停用後對外 API 立即拒絕、過期、`last_used_at`、驗證失敗的 429 |
| 路由稽核 | `test/route-audit.spec.ts`：三種寫錯的入口宣告會讓啟動失敗；對外路由的清單 |

# production 只檢查部分秘密的強度，其餘金鑰只要有值就通過

## 現況

`apps/api/src/core/config/env.schema.ts`：

- `EXAMPLE_SECRETS` 與 `isWeakSecret()`（L363–380）會擋三種值：範例值、含 change-me 的字串、不同字元少於 10 個的字串。
- `ProductionEnvSchema`（L383–421）只對三個變數套用這個檢查（L385–401）：
  - `JWT_SECRET`、`FILE_STORAGE_SECRET_ACCESS_KEY`：擋低熵。
  - `FILE_STORAGE_ACCESS_KEY_ID`：只擋範例值。

其他秘密只檢查「有沒有值」：

| 變數 | 檢查 | 會通過的弱值 |
| --- | --- | --- |
| `OIDC_COOKIE_KEYS` | L409–411：至少一把 | `a` |
| `TENANT_SECRET_KEY`、`IDP_SECRET_KEY`、`WEBHOOK_SECRET_KEY` | L412–420 只檢查有值。`SecretBox.fromConfig()`（`core/crypto/secret-box.ts` L38–51）在建立時才要求 base64 解開後是 32 bytes | 32 個 0x00 的 base64 |
| `OIDC_JWKS` | L406–408：有值 | 格式要到 oidc-provider 啟動時才驗 |
| `POSTGRES_*_PASSWORD` | 只靠 compose 的 `:?required` | 任何非空字串 |

- `.env.example` 的範例值在 production 都會被拒絕（`JWT_SECRET`、`FILE_STORAGE_*`），金鑰類則本來就留空。問題出在手動填入的短值或測試值。
- 初始管理者的密碼另見 [`platform-admin-bootstrap-password-logged.md`](./platform-admin-bootstrap-password-logged.md)。

## 影響

- 從範例、文件或測試複製來的弱值能通過啟動檢查，例如 `OIDC_COOKIE_KEYS=secret`。
- 各金鑰的影響程度不同：
  - 三把 SecretBox 金鑰保護資料庫裡的租戶連線字串、外部 IdP 的 client secret、webhook 的簽章密鑰。金鑰弱，等於 DB 外洩時這些資料可以直接解開。
  - IdP cookie 的金鑰弱，影響比較小：就算偽造簽章，仍需要猜中伺服器端的 session id。
- 前提是維運填了弱值。目前沒有證據顯示已經發生。

## 修正方式

1. `ProductionEnvSchema` 的 `secrets` 擴大檢查範圍：
   - `OIDC_COOKIE_KEYS` 的每一把都要檢查，並要求至少 32 字元。
   - 三把 SecretBox 金鑰要拒絕不同位元組太少的值，例如解開後不同的 byte 少於 16 個。
2. `OIDC_JWKS` 在 env 驗證時就 parse：必須是 `{ keys: [...] }`，而且至少一把含私鑰（RSA 或 EC 的 `d`）。錯誤訊息要直接指出問題。
3. 文件：04-sso.md §7 已寫產生方式（`openssl rand -base64 32`）。在 [`02-repository-structure.md`](../architecture/02-repository-structure.md) §5 補一句「production 會拒絕低熵的值」，並列出受檢查的變數。

## 驗證方式

- 在 `apps/api/src/core/config/__tests__/env.schema.spec.ts` 補 production 的案例：
  - `OIDC_COOKIE_KEYS=a` → 拋錯。
  - `TENANT_SECRET_KEY` 是 32 個 0 的 base64 → 拋錯。
  - `OIDC_JWKS='{"keys":[]}'` → 拋錯。
- 現有的「設定齊全、金鑰是隨機值時可以啟動」案例（L29–33）用的是 `'{"keys":[]}'` 與短的金鑰，要一起換成合格的值。

# 03 — 後端規範

`apps/api`（NestJS ＋ Drizzle）。分層與機制的完整說明在
[`architecture/backend/`](../architecture/backend/README.md)；這份只列寫程式時的規則。

---

## 1. 分層規則（不可違反）

| #   | 規則                                                                                          | 理由                                             | 強度          |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------- |
| 1   | `core/` 永遠不 import `modules/`                                                              | 機制層不認識業務                                 | 👀 Review     |
| 2   | Controller 不含業務邏輯，只做 HTTP ↔ DTO 與 `@RequirePermissions` 宣告                         | 業務規則要能被 CLI、排程、測試直接呼叫           | 👀 Review     |
| 3   | Repository 不含業務判斷，只有 Drizzle 查詢                                                    | 「可不可以」只在一個地方決定                     | 👀 Review     |
| 4   | 每個路由宣告 `@Public()` / `@Authenticated()` / `@RequirePermissions()` 其中之一               | 預設拒絕；漏宣告不能變成公開                     | 🔒 啟動檢查（`common/route-audit.ts`） |
| 5   | Service 拋 `AppException(ErrorCode)`，不拋 `HttpException`                                     | Service 不依賴 HTTP 語境                         | 👀 Review     |
| 6   | 稽核寫入在交易 **內**；快取失效在交易 **後**                                                   | 業務與紀錄同生共死；rollback 時不留下錯的快取    | 👀 Review     |
| 7   | 刪除角色前 **先** 查出受影響的使用者，再刪                                                     | cascade 之後就查不到人，快取無從失效             | 👀 Review     |
| 8   | 跨模組只注入對方 `exports` 的 service，不注入 repository；不用 `forwardRef`                    | 循環依賴代表職責畫錯了                           | 👀 Review     |

完整的依賴矩陣見 [`07-layer-dependencies.md`](./07-layer-dependencies.md) §3。
各層「可以／不可以」的對照表見
[`architecture/backend/01-architecture.md`](../architecture/backend/01-architecture.md) §1.1。

---

## 2. 各層寫法

### 2.1 Controller

- **Controller 裡沒有 `if`。** 通用權限交給 decorator，業務規則交給 service。
- 一個 handler 只呼叫一個 service 方法。
- 參數驗證用 `ZodValidationPipe(XxxSchema)`；路徑上的 id 用 `ParseUUIDPipe`。
- 需要操作者時用 `@CurrentUser()`，不從 `Request` 手動取。
- 權限鍵用常數，不寫裸字串。範例見
  [`architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §6。

### 2.2 Service

- 業務規則、交易邊界、跨 repository 協調都在這一層。
- 需要多個寫入時用 `withTransaction()`；稽核的 `record(…, tx)` 放在同一個交易內。
- 會影響權限的寫入，交易結束後呼叫 `permissionCache.invalidate()` / `invalidateMany()`。
  失效時機清單見 [`architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §5.1。
- 不碰 `Request` / `Response`。

### 2.3 Repository

- 只放 Drizzle 查詢，回傳 row 型別（或明確的投影型別）。
- 每個寫入方法接受可選的 `tx?: Transaction`，預設用 `this.db`。
- 列表查詢一次 join 取齊，避免 N+1。見
  [`architecture/backend/02-database.md`](../architecture/backend/02-database.md) §4.4。

### 2.4 DTO

- 一個檔案放一組相關的 Zod schema；型別一律 `z.infer` 推導。
- schema 用 `defineSchema('XxxRequest', z.object(…))` 登記，才會以 `$ref` 出現在 OpenAPI。
- 字串欄位預設 `.trim()` 並設上限（`max()`）；陣列設上限。
- 改完 DTO 或 controller 後跑
  `pnpm --filter @game-editor/api openapi:generate && pnpm sdk:generate`。

---

## 3. 錯誤

- 新錯誤碼加在 `core/errors/error-code.ts`，同時決定它對應的 HTTP 狀態碼。
- 命名 `<DOMAIN>_<REASON>`（`ROLE_SYSTEM_PROTECTED`）；已發布的錯誤碼 **不改名**，前端與語系檔依賴它。
- 同步前端語系檔的 `error.<CODE>`（🔒 `locales.test.ts` 會檢查）。
- 錯誤碼清單與流程見 [`architecture/backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §5。

---

## 4. API 設計

遵守 [`architecture/backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md)：

- 成功回應包 `{ data }`，失敗回應 `{ error: { code, message, details? } }`（由攔截器／過濾器處理，handler 直接 return 資料）。
- 時間用 ISO 8601 UTC；ID 用 uuid；「沒有值」用 `null` 不用空字串；欄位 camelCase。
- 不加 `/v1` 前綴；不破壞既有路徑。

---

## 5. 資料庫

- 改 schema → `pnpm db:generate` → **人工檢視 SQL** → `pnpm db:migrate`。
- migration 進版控；**已套用到任何共用環境的 migration 不可修改**，要改就發新的一支。
- Trigger、function、資料修補用手寫 migration。
- 破壞性變更拆兩次部署（先加欄位並雙寫，再移除舊欄位）。
- 規則全文見 [`architecture/backend/02-database.md`](../architecture/backend/02-database.md) §5。

---

## 6. 權限變更

新增或修改權限時，**同一批** 修改：

1. `docs/rbac/02-permission-catalog.md`
2. `apps/api/src/db/seeds/permissions.ts`
3. 前端 `features/<name>/permission.ts`
4. 兩個語系檔的 `permission.<resource>.<action>`

🔒 `route-audit.spec.ts` 以一份端點 × 權限總表釘住每個路由的宣告，對應
[`architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §9。

---

## 7. 日誌

- 用 `new Logger(Xxx.name)`（`@nestjs/common`，底層接 Pino），不用 `console.*`（`db/`、`scripts/` 例外）。
- 不記錄密碼、token、refresh cookie；敏感欄位清單見
  [`architecture/backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §5.1。

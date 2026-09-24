# ADR-0007 — 前端 SDK 由後端 OpenAPI 產生

- 狀態：**提案中（待確認）**
- 日期：2026-09-19
- 相關：[`../architecture/backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §7

## 背景

前後端需要共用型別，特別是 **權限鍵（`PermissionKey`）**。
如果兩邊各自維護一份清單，遲早會分歧——而權限鍵分歧的後果是
「前端顯示了按鈕但後端拒絕」或更糟的「前端隱藏了使用者其實有權限的功能」。

## 決定

```
apps/api  ──(@nestjs/swagger + zod-openapi)──▶  openapi.json
                                                     │
                                                     ▼ (packages/api-sdk/codegen)
                                          packages/api-sdk
                                                     │
                                                     ▼
                                    apps/web/src/shared/api-sdk (re-export)
```

- **後端是唯一事實來源**
- 權限鍵透過一個 `z.enum(ALL_PERMISSION_KEYS).openapi({ ref: 'PermissionKey' })`
  出現在 spec 裡，於是 SDK 會產生對應的 const 物件
- 前端的 `core/permission/enums.ts` 只做一層 re-export
- `apps/web/src/shared/api-sdk/index.ts` 是整個前端對 SDK 的 **唯一** 引用點
- CI 檢查：重新產生 `openapi.json` 後 `git diff` 必須為空

## 理由

1. **權限鍵只定義一次。** 後端的 `PERMISSION_SEED` 是唯一來源，
   前端拿到的是它的投影。
2. **型別不會過期。** 後端改了回應形狀，重新產生 SDK 後前端會編譯失敗——
   在 CI 就發現，而不是上線後。
3. **`shared/api-sdk` 的收斂點** 讓「換產生器」或「對某個型別做本地修補」
   只需要改一個檔案。
4. **NestJS 的 Swagger 整合幾乎零成本**，因為 Zod schema 已經用
   `.openapi({ ref })` 標註好了。

## 代價

| 代價                           | 緩解                                                               |
| ------------------------------ | ------------------------------------------------------------------ |
| 多一個產生步驟，忘記跑會不一致 | CI 檢查 `openapi.json` 的 diff；`pnpm build` 會先跑 `sdk:generate` |
| 產生的程式碼可讀性不如手寫     | 它不需要被讀，只需要被用；`shared/api-sdk` 隔離了它                |
| 後端未啟動時無法產生           | 從版控中的 `openapi.json` 產生即可，不需要跑起 server              |
| 產生器的 API 風格未必符合喜好  | 前端不直接用產生的 client，而是在 `apis/*/fetcher.ts` 包一層       |

## 替代方案

| 方案                          | 不採用的理由                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 手寫共用 `packages/contracts` | 要靠人維護同步，就是要避免的問題                                                                                    |
| tRPC                          | 要求前後端在同一個 TypeScript 專案並共用型別。與 NestJS 的 controller/DTO 模型不合，也放棄了 OpenAPI 帶來的可文件化 |
| GraphQL                       | schema 確實是單一來源，但為了一個 CRUD 管理後台引入 GraphQL 的複雜度不成比例                                        |
| 只共用權限鍵，其餘手寫型別    | 那就要維護兩套同步機制                                                                                              |

## 修訂：以自製產生器取代 orval（2026-09-24）

`packages/api-sdk/codegen/` 是專案自己的產生器，取代原本的 orval。

**產出**（`src/generated/`，整個目錄由產生器擁有）：

| 檔案 | 內容 |
| --- | --- |
| `models.ts` | `components.schemas` 的 TS 型別；字串 enum 另外輸出同名 `as const` 物件（`PermissionKey` 靠它） |
| `schemas.ts` | 同一批 component 的 zod schema（`UserSchema`…），以 `satisfies z.ZodType<User>` 和 `models.ts` 對齊 |
| `endpoints/<tag>.ts` | 每個 operation 的 `XxxInput` / `XxxResponses` / `XxxResult` 型別、`XxxSchemas`（path / query / headers / body / responses 的 zod）、URL builder `getXxxUrl(path?, query?)`、以及 fetch 函式 `xxx(input, options)` |
| `runtime.ts` | 由 `codegen/runtime.ts` 原樣複製：`request()`、`buildUrl()`、`ApiError`、`configureSdk()` |

**為什麼換掉 orval**

1. **只要 fetch、不要 middleware。** 攔截器（token、續期、重試、錯誤轉換）已經在
   `apps/web/src/core/client` 的 `HttpContext` 實作；SDK 再帶一套 mutator / interceptor 只會重疊。
   新產生器的執行期只有 `fetch`，需要客製傳輸時以 `options.fetch` 注入，不提供攔截器鏈。
2. **同時產出 zod schema。** 表單驗證與（可選的）回應驗證可以直接用 spec 產生的 schema，
   不必手寫一份「長得一樣」的 zod。
3. **每份 SDK 自給自足。** `runtime.ts` 複製進輸出目錄，多個後端各自產生 SDK 時設定互不干擾。
4. **命名可預測。** 巢狀的匿名物件不再被拆成 `XxxController200Data` 這類型別；
   需要內層型別時用索引存取（`UserControllerListResponse['data']`）。

**開源套件**：只用 `openapi-types`（spec 的型別定義）與 `tsx`（執行 TS 寫成的 CLI）；
zod 與 TS 的輸出由產生器自己寫，才能掌握 `$ref` → 具名 schema、循環引用（`z.lazy`）與宣告順序。

**支援範圍**：OpenAPI 3.0 / 3.1 的 JSON spec，只接受文件內的 `$ref`（外部檔案請先 bundle）。
cookie 參數不產生；`prefixItems`（tuple）以一般陣列表示——這些情況 CLI 會印出警告。


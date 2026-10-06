# 01 — 共通規範

前後端與 `packages/*` 都適用。前端、後端各自的補充見
[`02-frontend.md`](./02-frontend.md)、[`03-backend.md`](./03-backend.md)。

---

## 1. 格式與 Lint

| 規則                                                            | 強度    |
| --------------------------------------------------------------- | ------- |
| 格式一律交給 `oxfmt`（單引號、分號、行寬 100、trailing comma）   | 🔒 工具 |
| commit 前 `lefthook` 對 staged 檔案跑 `oxfmt --check` 與 `oxlint` | 🔒 工具 |
| `docs/**` 與 `*.md` 不經過 formatter，由人維護                  | 🔒 工具 |
| 不為了過 lint 而關規則；真的要關，用 `oxlint-disable-next-line <rule>` 並在同一行或上一行寫理由 | 👀 Review |

設定檔：`.oxfmtrc.jsonc`、`.oxlintrc.json`、`lefthook.yml`。

---

## 2. TypeScript

`tsconfig.base.json` 開了 `strict`、`noUncheckedIndexedAccess`、
`noUnusedLocals`、`noUnusedParameters`、`noImplicitOverride`，🔒 由 `pnpm typecheck` 守住。

### 2.1 型別逃生口

| ❌ 不要                                  | ✅ 改成                                                         | 強度       |
| ---------------------------------------- | --------------------------------------------------------------- | ---------- |
| `any`                                    | `unknown` ＋ 型別守衛（例：`isAppError(error)`）                 | 🔒 lint（warn） |
| `@ts-ignore`                             | 修型別；真的是上游問題才用 `@ts-expect-error` ＋ 理由             | 👀 Review  |
| 正式程式碼裡的 `as unknown as T`         | 讓型別自然推導；若是泛型實作的必要轉型，集中在一處並寫註解       | 👀 Review  |
| `value!`（非空斷言）                     | 先判斷再使用；`noUncheckedIndexedAccess` 產生的 `undefined` 要處理 | 👀 Review  |

測試檔可以用 `as unknown as T` 建立假物件（`.oxlintrc.json` 已對測試放寬 `any`）。

### 2.2 型別從哪裡來

- **API 的請求／回應型別只從 OpenAPI 產生**（`@b2b-system/api-sdk`），不手寫
  一份「長得一樣」的介面。見 [`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §12。
- 後端 DTO 型別用 `z.infer<typeof XxxSchema>` 推導，schema 是唯一來源。
- 權限鍵用 `PermissionKey`，**不寫裸字串**；拼錯會在編譯期被抓到。

### 2.3 寫法偏好

| 對象                     | 慣例                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| 物件形狀                 | `interface`；聯集、映射、工具型別才用 `type`                        |
| 列舉值                   | `as const` 物件 ＋ 推導聯集型別；不用 TS `enum`（例外：由 OpenAPI 產生的） |
| 型別 import（backstage / packages） | `import type`，🔒 `typescript/consistent-type-imports`         |
| 匯出                     | 具名匯出；**只有** `pages/<Page>/page.tsx`（給 lazy 用）、Storybook 的 `*.stories.tsx`（CSF 規定）與工具設定檔用 `export default` |
| 回傳型別                 | `core/`、`common/`、`packages/*` 等跨層匯出的函式明確標註；hook 與元件可交給推導 |

---

## 3. 命名

| 對象                               | 慣例                                          | 例                        |
| ---------------------------------- | --------------------------------------------- | ------------------------- |
| 前端資料夾（feature / api domain） | kebab-case                                    | `audit-log/`              |
| 前端 `apis/` 的操作資料夾          | kebab-case 動詞開頭                           | `get-role-list/`          |
| 前端元件檔                         | PascalCase                                    | `RoleTable.tsx`           |
| 前端 hook                          | `use` + PascalCase                            | `useRolePermission.ts`    |
| 前端頁面                           | `pages/<PageName>/page.tsx`                   | `pages/RoleList/page.tsx` |
| 後端檔案                           | kebab-case ＋ NestJS 後綴                     | `role.service.ts`         |
| DB 表                              | 複數 snake_case                               | `relation_tuples`         |
| DB 欄位                            | snake_case                                    | `created_at`              |
| Drizzle 變數                       | camelCase 複數                                | `rolePermissions`         |
| 權限鍵                             | `camelCaseResource:camelCaseAction`           | `auditLog:read`           |
| 錯誤碼                             | SCREAMING_SNAKE，以領域開頭                   | `ROLE_SYSTEM_PROTECTED`   |
| 查詢鍵常數                         | SCREAMING_SNAKE ＋ `_QUERY_KEY`               | `ROLE_LIST_QUERY_KEY`     |
| Zod schema                         | PascalCase ＋ `Schema`                        | `CreateRoleSchema`        |
| 布林                               | `is` / `has` / `can` 開頭                     | `canGrantPermission`      |
| TestId                             | `data-testid="<feature>-<element>"`，變動部分放 `data-value` | `role-table-row`          |
| 語系鍵                             | 見 [`architecture/frontend/08-i18n.md`](../architecture/frontend/08-i18n.md) | `role.create.success` |

i18n key、className、`data-testid` 一律寫完整字面量，見 [`06-literal-strings.md`](./06-literal-strings.md)。

同一個概念在前端 feature、後端 module、DB 表、權限 resource 用 **同一個字根**
（`role` / `roles` / `role:*`），找東西不需要換腦袋。

---

## 4. 匯入

- 🔒 匯入順序由 `oxfmt` 的 `sortImports` 排序，不手動調整。
- 🔒 `import/no-cycle`：不允許循環匯入。
- 🔒 Node 內建模組加 `node:` 前綴（`unicorn/prefer-node-protocol`）。
- 👀 跨資料夾一律用 `@/` alias；相對路徑只用在同一個 feature / module 內（前端跨 feature 🔒 `layer-dependencies.test.ts`），且不超過兩層（`../../`）。

分群順序（前端為例）：

```ts
// 1. 外部套件
import { useQuery } from '@tanstack/react-query';
// 2. workspace 套件
import { Button } from '@b2b-system/ui/Button';
import { useToast } from '@b2b-system/web-core/notify';
// 3. 專案內 alias（shared → core → apis；api-sdk 只經由 @/shared/api-sdk）
import type { Role } from '@/shared/api-sdk';
import { usePagePermission } from '@/core/permission'; // app 的門面（機制在 @b2b-system/web-core/permission）
import { getRoleListQueryOptions } from '@/apis/role/get-role-list/query';
// 4. 同 feature 內（相對路徑）
import { RoleFilter } from './components/RoleFilter';
```

---

## 5. 註解

- 註解寫 **為什麼**，不寫程式碼已經說清楚的 **做什麼**。
- 引用規格時寫出處：`（docs/architecture/backend/05-rbac.md §7）`。搬動文件或程式時要一起改。
  前端（兩個 app 與 `packages/{web-shared,ui,web-core}`）🔒 由 `packages/web-core/src/__tests__/comment-paths.test.ts` 檢查註解裡的路徑存在：
  從 repo 根目錄寫起的 `apps/…`、`packages/…`、`docs/…`；反引號括住的 `core/…`、`app/…`、`apis/…`、`features/…` 等（app 的 `src/` 底下）
  與 `web-core/…`、`ui/…`、`web-shared/…`（`packages/<名稱>/src/` 底下）。web-core 的檔案在 app 的註解裡寫 `web-core/…`，不寫 `core/…`。
- 與文件不同的實作決定，在程式碼註解說明原因，並登記到根目錄 `CLAUDE.md`
  的「與文件不同的實作決定」表。
- 公開 API（`core/`、`common/`、`packages/web-shared`、`packages/ui`、`packages/web-core` 匯出的東西）用 `/** */`，
  讓 IDE hover 看得到。
- 全文 zh-TW；程式碼識別字、錯誤碼、權限鍵保持原文。
- 不留被註解掉的程式碼；要留紀錄就交給 git。`TODO` 要附上追蹤方式（issue 或里程碑）。

---

## 6. 錯誤處理

| 情境               | 做法                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- |
| 後端業務錯誤       | `throw new AppException(ErrorCode.XXX)`，見 [`03-backend.md`](./03-backend.md) §3              |
| 後端啟動 / 腳本錯誤 | `throw new Error('…')`，訊息用 zh-TW 並指出下一步（例：「請先跑 db:seed」）                  |
| 前端 API 錯誤      | fetcher 轉成 `AppError`；畫面訊息一律經過 `useErrorMessage()`，不顯示原始 `code` 或 `message` |
| 新增錯誤碼         | `@b2b-system/error-codes` 的 `ErrorCode` ＋ `@b2b-system/web-core` 的 `ERROR_MESSAGE_KEY`（漏了編譯失敗）與語系檔 `error.<CODE>`（前端要分支處理時再加進 `ErrorCodes`）；兩個 app 不必改 |

- 不吞例外：`catch` 裡至少要轉型、重拋或記錄其一；空的 `catch {}` 必須有註解說明為何安全。
- 🔒 `no-console` 為 warn；正式程式碼的紀錄走後端 Pino logger，前端不留 `console.log`。

---

## 7. 設定與環境變數

- 新增環境變數：同時改 `.env.example` ＋ 後端 `core/config/env.schema.ts`（Zod 驗證，
  缺少就啟動失敗）。前端變數必須以 `VITE_` 開頭。
- 程式碼不寫死網址、密鑰、TTL；前端一律打相對路徑 `/api`。
- 清單見 [`architecture/02-repository-structure.md`](../architecture/02-repository-structure.md) §5。

---

## 8. Feature flag

機制見 [`architecture/05-tenancy.md`](../architecture/05-tenancy.md) §5.2、[`architecture/05-tenancy.md`](../architecture/05-tenancy.md) §11。

| 規則 | 理由 | 強度 |
| --- | --- | --- |
| flag 只用在 **會被移除** 的試行；長期的模組開關用 `features`（[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §9），「誰可以做」用權限 | 三種開關各有生命週期，混用之後刪不掉 | 👀 Review |
| key 是 `<模組>.<名稱>`（camelCase），上線後不改名 | 改名等於新 flag，既有的覆寫會遺失 | 🔒 啟動檢查（目錄格式） |
| 每個 flag 都有 `owner` 與 `removeBy`；過期就移除或延期（改 `removeBy`） | 暫時的開關不強制就會變成永久的 | 🔒 測試（`feature-flags.spec.ts`） |
| 前端用 `useFlag` 或 catalog 的 `requires.flag` 隱藏，端點一定要標 `@RequireFlag` | 前端的隱藏只是體驗，存取控制在 api | 👀 Review |
| `@RequireFlag` 的 key 必須在目錄裡、不能標在平台端點 | 不在目錄裡的 flag 永遠是關的，端點會被關死 | 🔒 啟動檢查（`common/route-audit.ts`） |
| 移除 flag 時同一個 PR 刪掉判斷、舊路徑與目錄的那一列 | 程式先不依賴 flag，資料才清（讀取時會忽略殘留的覆寫） | 👀 Review |

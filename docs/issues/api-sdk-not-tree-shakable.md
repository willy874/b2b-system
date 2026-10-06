# api-sdk 的產物無法 tree-shake：兩個前端的首屏都帶著全部 zod schema，啟動時全部建構

## 現況

兩個前端只用到 api-sdk 的一小部分：

- 從 `@/shared/api-sdk` 以值匯入的只有 185 個 `get*Url`（共產生 194 個），以及 `PermissionKey`、`TenantFeature`、`PlatformPermissionKey` 三個 enum。
- 型別匯入不影響產物。全 repo 沒有任何地方使用 `*Schema`、`*Schemas`、`*Operation` 或 `request()`。

但打包器沒辦法把其餘的部分丟掉：

- `packages/api-sdk/package.json` 沒有宣告 `sideEffects`。
- `src/generated/index.ts` 以 `export *` 匯出 runtime、models、schemas 與每個 endpoint 檔；`apps/*/src/shared/api-sdk/index.ts` 再 `export * from '@b2b-system/api-sdk'`。
- 產生器把 schema 寫成模組頂層的函式呼叫，沒有 `/* @__PURE__ */`：
  - `packages/api-sdk/codegen/generate.ts` L154–155：`export const ${component.schemaName} = ${expression} satisfies z.ZodType<…>`（元件 schema，共 195 個）。
  - L311：`export const ${prefix}Schemas = {…} satisfies OperationSchemas`（每個操作一個，共 194 個）。
  - L347：`const ${definitionName}: OperationDefinition = { …, schemas: ${prefix}Schemas }`。
  - URL builder（L328–331）和這些物件放在同一個 endpoint 模組裡。
- 打包器無法證明 `z.object()` 等呼叫沒有副作用，所以約 1,500 次 `z.*()` 呼叫全部留在首屏，而且在模組載入時就執行。

量測方式：

- 以 `vite build`（`--sourcemap`，輸出到暫存目錄，不寫進 repo）建置兩個 app。
- 用 sourcemap 把首屏 chunk（`index.html` 的 entry 與 modulepreload）的位元組歸屬到來源模組。
- 結果：

  | app | api-sdk 在首屏的大小 | gzip |
  | --- | --- | --- |
  | backstage | 60,080 B | 9.2 KB |
  | platform | 53,022 B | 7.7 KB |

- 主要是 `dist/generated/schemas.js`（約 44 KB）。platform 的首屏連 webhooks、files、roles 等租戶端點的 schema 都有。
- 執行成本：Node 24 重新評估一次 `dist/generated/schemas.js` 需 21–66 ms（暖機後、不含下載）。

## 影響

- 兩個前端的每一次載入都要下載、解析、執行用不到的驗證程式。
  apps/platform 是所有人登入都會經過的入口，影響每一次登入。
- 違背 [`frontend/05-data-layer.md`](../architecture/frontend/05-data-layer.md) §2 的前提。
  文件說「一操作一資料夾，讓 bundler 能真正做 tree shaking」，但到了 SDK 這一層，每個 app 還是帶著所有端點。
- 端點越多越嚴重：每加一個端點，兩個前端的首屏都會變大。

## 修正方式

擇一或並用，建議 1：

1. 拆成兩個入口：
   - `@b2b-system/api-sdk`：型別、URL builder、enum，零 zod。
   - `@b2b-system/api-sdk/schemas`：zod schema、`OperationDefinition`、`request()`。
   - 產生器把 URL builder 輸出到不 import `../schemas` 的檔案。`package.json` 的 `exports` 加上子路徑。
   - 前端的 `shared/api-sdk/index.ts` 只轉出第一個入口。
2. 讓打包器可以丟掉沒用到的部分：
   - 產生器在頂層的 schema 建構與操作物件前加 `/* @__PURE__ */`，或改成 lazy getter（第一次讀取才建構）。
   - `package.json` 加 `"sideEffects": false`。
   - 這個方案仍需確認 endpoint 檔內的 `Operation` 物件也能被丟掉。

文件：[`frontend/17-shared-packages.md`](../architecture/frontend/17-shared-packages.md) §1 補一句「前端只用 URL builder 與型別」。

## 驗證方式

- `packages/api-sdk/codegen/__tests__/generate.test.ts`：斷言 URL builder 輸出的檔案不 import schema，或頂層呼叫都帶 `/* @__PURE__ */`。
- 建置兩個 app，用 sourcemap 確認首屏 chunk 不再含 `api-sdk/dist/generated/schemas.js`。
  可以做成 build 之後的檢查腳本：列出首屏模組，比對禁止清單。

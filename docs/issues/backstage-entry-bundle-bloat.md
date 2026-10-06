# backstage 的首屏 bundle 帶進只有特定頁面才用的程式（約多 50 KB gzip）

## 現況

兩個來源讓頁面才用得到的程式進了首屏（entry chunk 與 `index.html` 的 modulepreload）。

**1. `@/core/components` 的 barrel**

- `apps/backstage/src/app/plugin.ts` L7 與 `app/Layout.tsx` L8 從 barrel 匯入錯誤頁：

  ```ts
  import { NotFoundPage, RouteErrorPage } from '@/core/components';
  ```

- `core/components/index.ts` L1–5 用 `export *` 一併轉出 `ApiToken`、`ErrorPage`、`ExplainPath`、`Tag`、`VersionConflictAlert`。
- app 的 `package.json` 沒有宣告 `sideEffects`，打包器把整個 barrel 放進 entry chunk：
  - `api-token-create-submit`、`tag-assign` 等 testid 都出現在 `index-*.js`。
  - `ApiTokenTable.tsx` L5 匯入 `@b2b-system/ui/Table`，於是 `Table`（60 KB，含 TanStack Table）的 chunk 被 modulepreload。
  - `ApiTokenCreateDialog`、`TagAssignDialog` 用的 `Select`（29 KB）的 chunk 也被 modulepreload。

**2. 以元件本體登記的偏好頁分頁**

- `plugins/features/table-column-settings/plugin.ts` L6、L19：`Component: TableColumnsSection`。
  `TableColumnsSection` 用 `TableSettings`（`packages/web-core/src/components/RichTable/TableSettings/TableSettings.tsx` 匯入 `@dnd-kit/core`、`@dnd-kit/sortable`）。
- `features/notification/plugin.ts` L7、L28：`Component: NotificationPreferenceSection`。
- 登記在 plugin 的同步階段，所以元件本體在首屏。實際上只有偏好頁（本身是 lazy chunk）會渲染它們。

量測方式：

- 以 `vite build --sourcemap` 建置，輸出到暫存目錄，不寫進 repo。
- 對照組用一個 Vite 外掛在建置時改寫上述 import，同樣不改 repo。
- 首屏 JS 為 entry 加上所有 modulepreload，各檔分別 gzip 後加總：

| 建置 | 檔案數 | 原始大小 | gzip |
| --- | --- | --- | --- |
| 現況 | 70 | 1,191,337 B | 377,910 B |
| 錯誤頁改成 `from '@/core/components/ErrorPage'` | 60 | 1,092,605 B | 346,268 B（−31.6 KB） |
| 再把兩個偏好分頁改成 `lazy()` | 64 | 1,033,519 B | 327,578 B（合計 −50.3 KB，約 13%） |

其中 dnd-kit 在首屏占 44,029 B（14.2 KB gzip）。

## 影響

- backstage 的每一次首屏載入，都要多下載並解析 TanStack Table、dnd-kit、`Select`，以及 API token、標籤的對話框。
  登入後的第一個畫面會因此變慢，低階裝置與慢速網路更明顯。
- 這違背文件的意圖：
  - [`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §5 的說明框要求不把頁面樹拉進 `main.tsx` 的同步 bundle。
  - [`frontend/01-architecture.md`](../architecture/frontend/01-architecture.md) §2.2 把 `core/permission-graph` 分開，「才不會把樹狀圖套件帶進首屏」。
- 之後任何新元件放進 `core/components`，都會自動進首屏，沒有人會察覺。

## 修正方式

1. `app/plugin.ts`、`app/Layout.tsx` 改成 `from '@/core/components/ErrorPage'`。
   或把錯誤頁搬出 barrel，例如 `app/` 自己的錯誤頁模組。
2. 偏好頁的分頁改登記 lazy 元件：

   ```ts
   const TableColumnsSection = lazy(() =>
     import('./TableColumnsSection').then((m) => ({ default: m.TableColumnsSection })),
   );
   ```

   - `features/account/pages/Preference/page.tsx` L109 的 `<section.Component />` 外面包 `<Suspense>`。
   - `web-core/preference/registry.ts` 的 `Component: ComponentType` 在型別不相容時放寬，以接受 lazy 元件。
3. 選做：在 app 的 `package.json` 宣告 `sideEffects`，讓 barrel 裡沒用到的模組可以被丟掉。
   要先確認 `features/*/index.tsx` 頂層的 `Routes.XxxRoute.update(...)` 不受影響。

## 驗證方式

- 建置後檢查 `dist/index.html`：modulepreload 不再有 `Table-*`、`Select-*`、`sortable.esm-*`。
- 可以把這個檢查做成 build 後的腳本：列出首屏 chunk 的來源模組（sourcemap），比對「不該在首屏」的清單。
  這是模組清單，不是大小預算；大小預算在 [`features/observability.md`](../features/observability.md)。
- `plugins/features/table-column-settings/__tests__/TableColumnsSection.test.tsx` 照過。
- 偏好頁目前沒有頁面測試：補 `features/account/pages/Preference/__tests__/PreferencePage.test.tsx`，
  斷言 lazy 分頁先顯示骨架、載入後出現分頁內容。

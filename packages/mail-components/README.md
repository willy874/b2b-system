# @b2b-system/mail-components

api 的郵件範本（`apps/api/src/core/mail/`、各模組的 `*.mail.tsx`）用到的 React Email 元件與 `render()`。
規格見 [`docs/architecture/backend/11-mail.md`](../../docs/architecture/backend/11-mail.md) §1。

```tsx
import { Button, render, Text } from '@b2b-system/mail-components';
```

## 為什麼不直接依賴 react-email

React Email 6 把元件、轉換工具與預覽伺服器、CLI 放在同一個套件。api 直接依賴它時，`pnpm deploy --prod` 會把
esbuild、babel、chokidar、prompts、commander… 一起裝進正式映像，程式用不到，卻要一一判斷它們的漏洞。

這個 package 在建置時以 esbuild 把用到的元件與 `render` 打包成 `dist/index.cjs`；`react-email` 只是 devDependency，
正式映像只帶這一個檔案。

## 規則

- 要 **build** 到 `dist/`：新 clone 或改了之後跑 `pnpm build:packages`（`pnpm dev` 會先跑）。
- 範本要用新的元件時加進 `src/index.ts` 的匯出清單。
- `react`、`react-dom` 是 peer 依賴，由 api 提供，打包時排除（`render` 在執行期載入 `react-dom/server`）。
- 升級 `react-email` 之後，確認 `apps/api` 的郵件測試照常通過，信件的 HTML 不變。

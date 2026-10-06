# @b2b-system/web-shared

backstage 與 apps/platform 共用的 **前端純工具**：前端分層的最底層（[`docs/conventions/07-layer-dependencies.md`](../../docs/conventions/07-layer-dependencies.md) §2）。
四個前端 package 怎麼分工見 [`docs/architecture/frontend/17-shared-packages.md`](../../docs/architecture/frontend/17-shared-packages.md)。

只有原始碼、不 build：`exports` 是 `{ "./*": "./src/*/index.ts" }`，由各 app 自己的 Vite 編譯。

## 匯入

一個模組一個子路徑，對應 `src/<module>/index.ts`：

```ts
import { createStore } from '@b2b-system/web-shared/store';
import { useStore } from '@b2b-system/web-shared/hooks';
import { createFakeChannelHub } from '@b2b-system/web-shared/testing'; // 只給測試
```

| 模組 | 內容 |
| --- | --- |
| `store` | signal store（`createStore`、`watch`、`computed`、`syncStore`、`shareStore`）；只有這裡 import `@sigrea/core` |
| `hooks` | store 的 React 綁定（`create`、`useStore`、`useComputed`…）與通用 hook |
| `context` | plugin context（`install` / `uninstall`） |
| `registry` | 可訂閱、可反註冊的註冊表（`createRegistry`） |
| `channel` | 跨分頁／跨裝置的同步頻道、傳輸層、leader 選舉 |
| `storage` | `localStorage`／dictStorage／IndexedDB（blobStore）封裝 |
| `date`、`utils`、`constants`、`EventEmitter` | 日期格式化、`cn()` 等工具、語言等常數、事件發射器 |
| `testing` | 測試替身（`fakeChannelHub`） |

狀態與儲存的規格見 [`docs/architecture/frontend/09-state-and-storage.md`](../../docs/architecture/frontend/09-state-and-storage.md)。

## 規則

- **框架無關、不碰業務**：判斷標準是「複製到另一個專案能不能直接跑」。React 元件不放這裡（hook 可以）。
- `store/` 與 `context/` 不 import React（🔒 oxlint `no-restricted-imports`）。
- 只依賴 `@b2b-system/realtime` 與第三方套件；不 import `@b2b-system/ui`、`@b2b-system/web-core`、`api-sdk` 或任何 app 的程式碼。
- 認識 AppContext、i18n、session 等機制的東西放 `@b2b-system/web-core`；這裡只放複製到別的專案也能跑的。
- 讀 `import.meta.env` 的東西不放這裡：每個 app 的值不同，留在 app 的 `src/shared/constants/env.ts`。
  app 對 `api-sdk`、`realtime` 的收斂點（`src/shared/api-sdk`、`src/shared/websocket-sdk`）也留在 app。
- package 內部用相對路徑；子路徑之間會形成循環時直接指向檔案（例：`channel/leader` 直接 import `store/createStore`）。

## 測試

```bash
pnpm --filter @b2b-system/web-shared test
pnpm --filter @b2b-system/web-shared typecheck
```

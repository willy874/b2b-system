# @b2b-system/error-codes

api 與兩個前端（經由 `@b2b-system/web-core`）共用的 **錯誤碼清單**：`ErrorCode`（每個碼對應的 HTTP 狀態）、`ALL_ERROR_CODES`、`statusOf()`。
規格見 [`docs/architecture/backend/03-api-conventions.md`](../../docs/architecture/backend/03-api-conventions.md) §5；在 packages 裡的位置見 [`docs/architecture/frontend/17-shared-packages.md`](../../docs/architecture/frontend/17-shared-packages.md)。

```ts
import { ErrorCode, statusOf } from '@b2b-system/error-codes';
```

api 照舊從 `@/core/errors/error-code`（轉出這個 package）匯入。

## 規則

- **只有常數**，零依賴：api（Node）與瀏覽器都會載入。
- 要 **build** 到 `dist/`（api 在執行期讀它）：新 clone 或改了之後跑 `pnpm build:packages`（`pnpm dev` 會先跑）。
- 已發布的碼不改名；命名 `<DOMAIN>_<REASON>`。

## 新增一個碼

1. 加進 `src/index.ts`，決定 HTTP 狀態；`pnpm build:packages`。
2. `packages/web-core/src/errors/errorMessageKey.ts` 加一列——`ERROR_MESSAGE_KEY` 以 `satisfies Record<ErrorCode, …>` 宣告，漏了就編譯失敗。
3. `packages/web-core/src/locales/resources/{en_US,zh_TW}.json` 加 `error.<CODE>`（🔒 `locales/__tests__/resources.test.ts` 以 `ALL_ERROR_CODES` 比對）。兩個 app 都不必改。

```bash
pnpm --filter @b2b-system/error-codes build
pnpm --filter @b2b-system/error-codes typecheck
```

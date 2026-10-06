# 租戶佈建在執行期 import seed 腳本，違反層級規則，也沒有測試在擋

## 現況

[`conventions/07-layer-dependencies.md`](../conventions/07-layer-dependencies.md) 的規則：

- §3.1（L137）：`db/seeds/`、`db/migrations/`、`scripts/` 是獨立入口（CLI），不被執行期程式 import。
- §3.2 註 1（L151）：執行期只能 import 權限目錄 `db/seeds/permissions.ts`。

`apps/api/src/modules/tenant/tenant-provisioner.ts`（L12–16）在執行期 import 了 seed 腳本。它跑在 api 程序的背景工作 `tenant.provision` 裡：

```ts
import { createScriptClient } from '@/db/client';
import { ensureTenantDatabase, migrateTenantDatabase } from '@/db/provision';
import { seedPermissions, seedRoles } from '@/db/seeds';
import { seedTenantAdmin } from '@/db/seeds/super-admin';
```

- `seed()`（L192–208）用這些函式在新租戶的 DB 建立權限目錄、系統角色與第一位管理員。
- `db/provision.ts` 由 `db:migrate` 與佈建共用，這一點有寫在 [`architecture/05-tenancy.md`](../architecture/05-tenancy.md) L77，但 07 的矩陣沒有跟著更新。`db/seeds/index.ts` 與 `db/seeds/super-admin.ts` 則沒有任何文件說明。
- seed 函式用 `console.*` 輸出進度（`db/seeds/index.ts` 的 `seedPermissions()` L44、L50，`seedRoles()` L68、L87）。[`conventions/03-backend.md`](../conventions/03-backend.md) §7 只允許 `db/`、`scripts/` 用 `console`，前提是它們不在 api 程序裡跑。
- `src/__tests__/layer-dependencies.spec.ts` 沒有檢查 `db/seeds` 的規則。這條規則名義上存在，實際上沒有工具強制。
- 執行期另有 7 處 import `db/seeds/platform-permissions.ts`（平台的權限目錄，性質同 `permissions.ts`），註 1 也沒有列。

## 影響

- api 程序佈建租戶時，seed 的 `console.info/warn` 直接寫到 stdout：不是 Pino 的 JSON、沒有 requestId、不經 redact。正式環境收日誌時會混進非結構化的行。
- seed 腳本的改動（例：多印一行、改成讀 `process.env`）會直接變成執行期的行為，而改的人從檔案位置看不出來。
- 規則與實際不一致：之後有人照 07 判斷「改 seed 不影響執行期」或「執行期能不能用 seed」，會得到錯的答案。

## 修正方式

1. 把佈建也要用的 `seedPermissions`、`seedRoles`、`seedTenantAdmin` 搬到執行期可用的位置，例如 `db/bootstrap/`。
   - 不用 `console`：改成回傳結果（建了哪些角色、哪位管理員），或接受一個 logger，由呼叫端記錄。
   - CLI 的 `db/seeds/*` 改成呼叫它們。
2. 更新 07 §3.1、§3.2，列出執行期可以 import 的 `db/` 檔案：`db/seeds/permissions.ts`、`db/seeds/platform-permissions.ts`、`db/provision.ts`，以及新的 `db/bootstrap/`。
3. `layer-dependencies.spec.ts` 加一條：`core/`、`common/`、`modules/` import 的 `db/` 檔案（schema 以外）只能是上述白名單。

## 驗證方式

- 新的 layer 測試在搬移前失敗、搬移後通過。
- `apps/api/test/platform-tenant.spec.ts` 的佈建案例照常通過；佈建時 api 的日誌沒有非 JSON 的行。

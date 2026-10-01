# auth 的元件測試在高負載下容易逾時

| 項目 | 內容 |
| --- | --- |
| 嚴重度 | 低：開發體驗；不影響正式程式 |
| 範圍 | `apps/auth` 的測試設定 |
| 發現於 | 2026-10-01 升級測試工具時，多組測試同時跑 |

## 1. 現況

兩個前端 app 的 Testing Library 設定不一致：

- `apps/backstage/src/test/setup.ts:6` 有 `configure({ asyncUtilTimeout: 5000 })`，註解寫明原因：
  頁面整合測試會經過 lazy 載入，全套平行跑時 1 秒的預設等待不夠。
- `apps/auth/src/test/setup.ts` **沒有** 這行，`findBy*`／`waitFor` 用 Testing Library 預設的 1 秒。

apps/auth 的程式碼是從 backstage 複製的（[`apps/auth/README.md`](../../apps/auth/README.md)），測試的寫法也相同，
卻少了這項設定。

## 2. 影響

- 機器負載高時（例如 `pnpm test` 和 api 的 Testcontainers 整合測試同時跑），auth 會出現偶發的逾時或找不到元素。
  2026-10-01 實際遇到的有 AuditLogList、JobList、TenantDetail、PlatformAdminList 各 1 個；單獨重跑都會通過。
- 偶發失敗容易被誤認成新改動造成的問題，浪費排查時間。

## 3. 修正方式

在 `apps/auth/src/test/setup.ts` 加上和 backstage 相同的設定與註解：

```ts
import { cleanup, configure } from '@testing-library/react';

// 頁面整合測試會經過 lazy 載入（第一次 import 頁面模組），全套平行跑時 1 秒的預設等待不夠
configure({ asyncUtilTimeout: 5000 });
```

這只放寬「等待元素出現」的上限，不改變任何斷言；元素一出現就會繼續，正常情況下不會讓測試變慢。

## 4. 驗證方式

- `pnpm --filter @b2b-system/auth test` 全過，測試數量不變（目前 803 個）。
- 在負載下再跑一次，例如同時跑 `pnpm --filter @b2b-system/api test`，確認 auth 不再偶發逾時。

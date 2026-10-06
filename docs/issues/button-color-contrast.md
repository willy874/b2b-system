# 警告色與成功色按鈕的白字對比不足，對比測試只要求 3:1

## 現況

- `packages/ui/src/components/Button/Button.module.css`（L63–78）：`success`、`warning` 變體是實心填色，配白字（`--color-*-on`）。
- 對應的 token 在 `packages/ui/src/styles/tokens.css`（L110–115），hover 色在 L185–186（往表面色混 10%，會更淡）。

  | 組合 | 對比 |
  | --- | --- |
  | 白字／`--color-warning`（#d96c00） | 3.45:1，hover 時 3.03:1 |
  | 白字／`--color-success`（#2b8a3e） | 4.37:1 |
  | 白字／`--color-danger`（#c92a2a） | 5.46:1，合格 |

- 按鈕文字是一般文字：字重 500，`md` 14px（`packages/ui/src/styles/index.css` L22），`sm` 13px（`Button.module.css` L88–91）。WCAG AA 要求 4.5:1。
- `packages/ui/src/styles/contrast.test.ts` 的「狀態色作為填色時，其 -on 前景 >= 3:1」（L119–127）只要求 3:1，所以測試不會擋：

  ```ts
  expect(ratio, `${tone} fill`).toBeGreaterThanOrEqual(3);
  ```

- 文件也寫成 3:1：[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §4.4「搭配 `-on` 的白字仍 ≥ 3:1」。
  但同一份文件 §5 的基準是「文字 ≥ 4.5:1，大字與圖示 ≥ 3:1」。
- 實際用到的地方：列表的批次操作按鈕（`packages/web-core/src/components/RichTable/BatchBar.tsx` L140–142，`size="sm"`、`variant={action.tone}`）。
  - 使用者的「啟用」「停用」「解鎖」：`apps/backstage/src/features/user/pages/UserList/useUserBatchActions.ts` L25、L38、L51。
  - 審批的「核准」：`apps/backstage/src/features/approval/pages/ApprovalList/useApprovalBatchActions.ts` L24。

## 影響

- 弱視、或在強光下看螢幕的人，看不清橘色的「停用」，以及綠色的「啟用」「解鎖」「核准」按鈕。
- 淺色與深色主題都一樣：深色主題沿用淺色的填色。
- 只影響可讀性，不影響功能。

## 修正方式

1. 按鈕改用較深的填色。擇一（建議 a）：
   - a. 新增按鈕專用的 alias（例：`--color-warning-fill`、`--color-success-fill`），指向較深的色階：
     `--seed-yellow-800`（白字約 6.4:1）、`--seed-green-700`（約 6.6:1）。不影響 Chip、Progress 等其他用到狀態色的地方。
   - b. 把 `--color-warning` 本身調深到約 #b35c00（白字約 4.7:1）。這會連帶改變其他用到它的地方，要一起檢查。
   - 不建議改用深色字：深灰在 #d96c00 上約 4.48:1，仍不到 4.5。
2. hover 改成往深色混，或另外確認 hover 色也 ≥ 4.5:1。
3. `contrast.test.ts` 的門檻改成 4.5，並修正 07-ui-system.md §4.4 的說明。

## 驗證方式

- `packages/ui/src/styles/contrast.test.ts`：門檻改成 4.5 之後，兩個主題的 danger、success、warning 都通過。
- 補一個 hover 色的案例：先算出 `color-mix` 的結果再比對；或 hover 改用固定的 token，直接比對。

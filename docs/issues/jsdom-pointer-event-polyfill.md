# 測試環境的 `PointerEvent` polyfill 已經用不到

| 項目 | 內容 |
| --- | --- |
| 嚴重度 | 低：程式整潔 |
| 範圍 | `apps/backstage`、`apps/auth` 的測試設定 |
| 發現於 | 2026-10-01 升級 Base UI 1.8 與 jsdom 30 後 |

## 1. 現況

Base UI 從 1.0.0-rc.0 升到 1.8 時，Checkbox、Switch、Radio 的點擊改成以 `new PointerEvent('click')` 重送。
當時的 jsdom 26 沒有 `PointerEvent`，點擊會拋 TypeError，所以兩個 app 的測試設定都補了一個以 `MouseEvent` 為底的 polyfill：

- `apps/backstage/src/test/setup.ts:8-22`
- `apps/auth/src/test/setup.ts:5-19`

同一天稍後 jsdom 升到 30.1.1，它已經內建 `PointerEvent`（`typeof window.PointerEvent === 'function'`）。
polyfill 外層有 `if (typeof window.PointerEvent === 'undefined')` 判斷，所以現在 **整段都不會執行**。

## 2. 影響

- 沒有功能上的影響，只是留下一段不會執行的程式碼。
- 註解仍寫著「jsdom 26 沒有 PointerEvent」，和實際安裝的版本不符，容易誤導讀者。

## 3. 修正方式

刪除兩個 `setup.ts` 裡的整段 polyfill，連同上方的註解。

## 4. 驗證方式

- `pnpm --filter @b2b-system/backstage test` 與 `pnpm --filter @b2b-system/auth test` 全過，測試數量不變。
  RichTable 的勾選、FileBrowser 的勾選、Switch、Radio 的測試都會走到 `PointerEvent`，是最直接的確認點。
- `pnpm typecheck` 通過。

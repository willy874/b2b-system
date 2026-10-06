# 前端架構文件與實作不符：分層的強制方式、feature 的匯出約定、不存在的 plugin／store／頻道

## 現況

**1. 分層規則宣稱有 lint 與 CI 強制，實際上沒有**

- [`frontend/01-architecture.md`](../architecture/frontend/01-architecture.md)：
  - §2.2（L99–100）寫「`core/` 與 `packages/web-core/src` 不 import `features/`」，「這條規則由一個 lint 規則與 CI 檢查強制」。
  - §5（L237–250）列出 `.oxlintrc.json` 的 `no-restricted-imports` 規則：`src/core/**` 不 import `@/features/*`、`@/app/*`；feature 之間不互相 import；任何地方不用 `../../../*`。
  - §5 也寫「CI 另有一支腳本檢查 `features/*/index.tsx` 是否都匯出了 `Routes` 與 `<name>FeaturePlugin`」。
- 實際狀況：
  - `.oxlintrc.json` 的 `no-restricted-imports`（L52、L68、L88）只限制 `@sigrea/core` 與 `react`。
  - CI（`.github/workflows/ci.yml`，2026-10-06 加入）只跑 lint、typecheck 與測試，沒有分層或 `index.tsx` 匯出的檢查。
  - 前端沒有比照 `apps/api/src/__tests__/layer-dependencies.spec.ts` 的分層測試。
- 其他文件的說法相反：[`conventions/02-frontend.md`](../conventions/02-frontend.md) §1（L22）寫「目前 `.oxlintrc.json` 尚未設定，先靠 review」，[`conventions/07-layer-dependencies.md`](../conventions/07-layer-dependencies.md) §4 也說「其餘用搜尋自查」。
- 「不用 `../../../*`」在兩個 app 有 135 處（不含測試），例如 `features/announcement/pages/AnnouncementDetail/components/AnnouncementSettingsSection.tsx` L15–30。
- 2026-10-06 用 07 §4 的搜尋指令與一個解析相對路徑的腳本掃過，目前沒有實際越層。問題是沒有任何自動的防線。

**2. feature 的 `index.tsx` 匯出約定**

- [`frontend/03-feature-anatomy.md`](../architecture/frontend/03-feature-anatomy.md) §2.1（L82）：「只能匯出這兩樣東西」（`Routes` 與 plugin）。
- 實際上各 feature 另外匯出頁面鍵、註冊函式與 hook：
  - `apps/backstage/src/features/auth/index.tsx` 匯出 `useSyncPermissions`、`useLogoutMutation`，由 `app/App.tsx` 使用。
  - `features/role/index.tsx` 匯出 `ROLE_PAGE`、`registerRolePagePermissions`，由 `core/permission/__tests__/feature-registration.test.ts` 使用。
- 07 §2.2 的矩陣允許 `app/` 匯入 feature 的 `index.tsx`，所以實作合理，是 03 的說法太嚴。

**3. 文件寫了、但程式裡不存在的東西**

- [`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §4.1（L194）的 `componentPlugin`／`componentRegistry`。
- [`frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §2.1（L82–89）：
  - `tableFilterSettings` store 不存在。
  - `layout` store 沒有「密度」（`packages/web-core/src/store/layout.ts` 只有 `sidebarCollapsed`）。
  - 實際存在的 `theme`、`headerToolbar`（`store/preference.ts`）沒有列出。
- 09 §5「目前的頻道」（L349 起）缺 `store:file-view:storage`（`apps/backstage/src/features/file/preference.ts` L40）。
  §5 自己規定新增頻道要補進這張表。

**4. 範例對應的是死碼**

- [`frontend/04-routing.md`](../architecture/frontend/04-routing.md) §6（L274 起）以 `RoleDetailRoute` 的 route context eventBus 當範例，說明子頁 `emit`、工具列 `on`。
- 程式裡 `features/role/routes/pages.ts` L31–36 仍然建立這個 `EventEmitter`，但全 repo 沒有任何 `emit` 或 `on`。
- 程式的死碼與 04 §6 已在 2026-10-07 一併處理（`refactor: 刪除前端沒有人用的程式與 route context 的範例`）。

## 影響

- 讀文件的人（含 AI 助理）會以為越層會被 lint 或 CI 擋下，因此放心地 review；實際上只有搜尋自查。
- 依 03 的規則，看到 feature 的 index 匯出 hook 會以為違規；依 02、09 的清單找 `componentPlugin`、`tableFilterSettings` 會找不到。
- 新增頻道沒有更新 09 §5，持有者與傳輸層的檢查表就不完整。
- 都是文件問題，不影響執行。

## 修正方式

1. 分層，擇一（建議 a）：
   - a. 補前端的分層測試，比照 `apps/api/src/__tests__/layer-dependencies.spec.ts`，放進 `pnpm test`：
     - app 的 `core/` 與 `packages/web-core` 不 import `features/`。
     - feature 之間不互相 import，包含相對路徑。
     - packages 不 import app；下層 package 不 import 上層。
     - `features/*/index.tsx` 都匯出 `Routes` 與 plugin。
     - 完成後把 02、07 的強度標成 🔒，01 §2.2、§5 改成指向這支測試。
   - b. 把 01 §2.2、§5 改成與 02、07 一致的「靠 review＋搜尋自查」，刪掉 CI 腳本的描述與 `../../../*` 那一列（或改成只限跨 feature）。
2. 03 §2.1：列出 index 可以匯出的東西：`Routes`、plugin、頁面鍵與註冊函式（給 app 與完整性測試），以及 app 組裝需要的 hook。
3. 02 §4.1 刪掉 `componentPlugin` 那一列。
4. 09 §2.1 改成實際的 store 清單；§5 補 `store:file-view:storage`（持有者是 `features/file/preference.ts` 的 dictStorage，只同步本機分頁）。
5. 04 §6：程式刪掉 route context 之後，範例改成真的在用的情境，或整節刪除。

## 驗證方式

- 方案 a：新的分層測試在 `pnpm test` 中執行。故意在 `core/` 加一行 `import … from '@/features/…'`，測試要失敗。
- 文件：搜尋 `componentPlugin`、`tableFilterSettings` 只剩歷史紀錄；09 §5 的頻道表與 `git grep "createChannel("` 的結果一一對得上。

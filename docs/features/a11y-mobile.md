# 無障礙與行動版

- 優先度：P3
- 狀態：提案
- 依賴：UI 系統的可近性基線（[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §5、§3.14、§8）；外框（`packages/web-core/src/layout/DashboardShell.tsx`）；
  共用 packages（[`frontend/17-shared-packages.md`](../architecture/frontend/17-shared-packages.md) §2）；測試（[`frontend/10-testing.md`](../architecture/frontend/10-testing.md)）
- 相關：[`settings-navigation.md`](./settings-navigation.md)、[`account-self-service.md`](./account-self-service.md)（頁內目錄在窄螢幕的形式）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §5 的「可近性基線」管的是 **元件**（對比度、焦點外框、表單標籤、圖示按鈕、停用說明、減少動效），
`packages/ui` 每個元件也有鍵盤測試（§8）。但 **頁面層級** 沒有規範，也沒有自動檢查：

| 位置 | 現況 | 問題 |
| --- | --- | --- |
| `packages/web-core/src/layout/DashboardShell.tsx:167` | `<main className={styles.content}>`；之前是側欄（`<aside>`，:100）與頂列（`<header>`，:129） | 沒有「跳到主要內容」的連結，鍵盤使用者每換一頁都要 Tab 過整個側欄與頂列工具 |
| 換路由 | `web-core/shell/DocumentTitle.tsx` 會更新 `document.title` | 焦點留在剛按的側欄連結上，報讀器不會念出新頁面；SPA 的換頁對報讀器是無聲的 |
| repo 全域 | 沒有 axe（`package.json`、各 app 與 packages 都沒有相依） | 標題階層、地標、重複的 id、缺少名稱的連結這類頁面問題只能靠人工發現 |
| `apps/e2e/playwright.config.ts:22` | `projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }]` | 沒有任何行動裝置尺寸的 E2E；外框的抽屜模式（`NARROW_QUERY = '(max-width: 767px)'`，`DashboardShell.tsx:24`）沒有被測過 |
| 31 個 backstage 頁面（apps/platform 另有 10 個） | 各自手寫 `<header>` ＋ `<h1 className="m-0 text-xl font-semibold">` ＋ 說明 ＋ 按鈕群 | 版面不一致；列表頁的 header 是 `flex items-center justify-between` 沒有 `flex-wrap`（例：`features/user/pages/UserList/page.tsx:139`），窄螢幕時按鈕把標題擠成一字一行。web-core 已有 `job/JobPageHeader.tsx`，只給背景工作頁用 |
| `features/organization/pages/Organization/page.tsx:186` | 樹與詳情固定橫排（`flex … gap-4`） | 樹的面板 `components/OrgUnitTreePanel.tsx:107` 是 `w-72 shrink-0`，375 px 寬時詳情只剩約 50 px |

已有的響應式做法散在各規格：檔案管理器的側欄只在 `lg` 以上（[`frontend/12-file-manager.md`](../architecture/frontend/12-file-manager.md) §3）、圖片庫 < 640 px 改方格（[`frontend/24-gallery.md`](../architecture/frontend/24-gallery.md) §2）、
`Toolbar`／`Tabs`／頂列工具放不下時收進「更多」（[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §3.14）。斷點與「窄螢幕時怎麼排」沒有統一的規則。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 外框：「跳到主要內容」連結、`<main id tabIndex={-1}>`、換路由後焦點移到頁面標題並以 live region 念出（§1） | 原生 App、PWA、離線 |
| 共用的 `PageHeader`（`@b2b-system/ui`）：標題、說明、動作；窄螢幕時動作換行；兩個 app 的頁面逐步改用（§2） | 觸控手勢（長按多選等，[`frontend/24-gallery.md`](../architecture/frontend/24-gallery.md) D27 已決定不做） |
| 頁面層級的響應式規則寫進 `07-ui-system.md`：斷點、雙欄頁在窄螢幕的形式（§3） | 每一頁都做到行動版的完整體驗：這一版只保證「不破版、能操作」 |
| 組織頁在窄螢幕改成上下排列或樹的抽屜（§3） | 樹狀圖編輯器（`TreeEditor`）、組織圖在手機上的編輯（只保證可檢視） |
| axe 的自動檢查：元件測試（vitest ＋ `axe-core`）與 E2E（`@axe-core/playwright`）（§4） | WCAG 的正式稽核與聲明 |
| Playwright 加一個行動裝置的 project，跑一組冒煙測試（§4） | 每一條 E2E 都在兩種尺寸跑 |

## 使用者故事

**作為只用鍵盤的使用者，我希望進入每一頁後按一次 Tab 就能跳過選單，以便直接操作頁面內容。**

- **Given** 我在使用者列表
- **When** 我從側欄選「角色」
- **Then** 報讀器念出「角色 · 後台」，焦點在頁面的 `h1`；按 Tab 進入頁面的第一個控制項，不必經過側欄

**作為在手機上核准申請的主管，我希望列表頁與組織頁不破版，以便不必回到電腦前。**

- **Given** 375 × 812 的手機
- **When** 我打開組織頁
- **Then** 部門樹收成上方的「選擇部門」按鈕（抽屜），詳情佔滿寬度；列表頁的標題在上、按鈕換到下一行

## 初步構想

### 1. 外框（`packages/web-core/src/layout/`、`shell/`）

- `DashboardShell` 最前面加 `SkipLink`（視覺隱藏、聚焦時出現，文字走 web-core 的共用語系 `common.skipToContent`），指向 `<main id="main-content" tabIndex={-1}>`。
- `RouteFocusManager`（與 `DocumentTitle` 同樣放在 `RouterProvider` 之外、以參數接 router）：路由的 `pathname` 改變（search 改變不算，篩選列表不該搶焦點）且載入完成後，
  把焦點移到 `main` 內第一個 `h1`（沒有時移到 `main`），並在一個常駐的 `aria-live="polite"` 區域寫入頁面標題（沿用 `staticData.titleKey`）。對話框路由（`/user/create` 這類）不移動焦點，交給 `Dialog`。
- apps/platform 用同一個外框，一次兩個 app 都有。

### 2. `PageHeader`（`packages/ui/src/components/PageHeader/`）

- props：`title`、`description?`、`actions?`（ReactNode）、`meta?`（標題旁的 Chip，例：狀態）、`headingLevel`（預設 1）；不含業務名詞，可放 `ui`。
- 版面：`flex flex-wrap items-start justify-between gap-x-4 gap-y-2`；動作區在窄容器時佔滿一行並靠右，多個按鈕時建議包 `Toolbar` 讓它收進「更多」（§3.14）。
- `JobPageHeader` 改用它；兩個 app 的 41 個手寫標題分批替換（每個 feature 一個 commit）。替換後在 `app/__tests__` 加一條守門測試：`features/**/pages/**/page.tsx` 不出現 `<h1`。
- 補 story 與鍵盤／換行的元件測試（§8 的驗收）。

### 3. 響應式規則（寫進 `07-ui-system.md` 新的一節）

| 斷點 | 用途 |
| --- | --- |
| `< 768 px`（與外框的 `NARROW_QUERY` 相同） | 側欄成抽屜；雙欄頁改上下或抽屜；表格交給 `RichTable` 既有的欄位隱藏 |
| `≥ 1024 px`（`lg`） | 雙欄頁的側面板（檔案管理器的樹、設定頁的目錄、組織樹）才常駐 |

- 斷點常數放 `web-shared`（框架無關），CSS 用 UnoCSS 的同名斷點；`useMediaQuery` 已在 web-core。
- **組織頁**：`< 1024 px` 時 `OrgUnitTreePanel` 收進 `Dialog`／側邊抽屜，頁面頂端顯示目前部門與「選擇部門」；選了就關閉。`w-72` 改成只在 `lg` 以上生效。
- 逐頁檢查的清單（列表頁、詳情、對話框表單、檔案管理器、圖片庫、審批詳情）放 E2E 的行動版冒煙測試，不另寫文件。

### 4. 自動檢查

- **元件**：`packages/ui` 的測試輔助加 `expectNoA11yViolations(container)`（`axe-core`，只開 WCAG 2.1 A／AA 規則，關掉 jsdom 量不到的 `color-contrast`——對比度已有 `contrast.test.ts`）。
- **E2E**：`@axe-core/playwright` 在 `apps/e2e/helpers/` 包一個 `checkA11y(page)`，先在冒煙測試的每一頁跑；既有違規以基準檔記下、只擋新增（開放問題 2）。
- **行動版 project**：`playwright.config.ts` 加 `{ name: 'mobile', use: devices['Pixel 7'], testMatch: /mobile\/.*\.spec\.ts/ }`，只跑 `apps/e2e/mobile/` 下的冒煙測試（外框抽屜、列表頁、組織頁、審批的核准）。CI 的時間多幾分鐘。
- 新的相依（`axe-core`、`@axe-core/playwright`）都是 dev dependency，不進 bundle（`bundle:check` 不受影響）。

## 開放問題

1. 換頁後焦點移到 `h1` 還是 `main`？移到 `h1` 報讀器會念標題，但部分頁面的 `h1` 在對話框路由裡會被 `Dialog` 蓋過；需要在幾個代表頁實測 VoiceOver 與 NVDA。
2. axe 的既有違規怎麼處理：一次修完再開檢查，還是以基準檔放行既有、只擋新增？基準檔要定期縮小，否則會一直留著。
3. 行動版要支援到什麼程度？只有「不破版、能看能核准」，還是建立、編輯也要好用？這決定組織圖、資料匯入預覽（類 Excel 的表格）這類頁面要不要另做窄螢幕版本。
4. `PageHeader` 的麵包屑（`Breadcrumbs`）要不要內建？詳情頁目前各自決定。
5. 守門測試（禁止手寫 `<h1`）會擋到合理的例外（登入互動頁、錯誤頁）——用白名單還是只掃 `features/**/pages`？

## 設計決策

## 歸檔去向

完成後預計寫成：

- [`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md)：§5 加入頁面層級的可近性（skip link、換頁的焦點與宣告、標題階層）、新增「響應式」一節、§2.2 的 `PageHeader`、§8 的驗收項目
- [`frontend/10-testing.md`](../architecture/frontend/10-testing.md)：axe 的元件與 E2E 檢查、行動版 project
- [`frontend/17-shared-packages.md`](../architecture/frontend/17-shared-packages.md) §2：`SkipLink`、`RouteFocusManager` 在 web-core

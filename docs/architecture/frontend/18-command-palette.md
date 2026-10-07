# 前端 18 — 命令面板（⌘K）與選單註冊表

在任何頁面按 ⌘K（Windows／Linux 是 Ctrl+K），或點頂列的搜尋按鈕，可以「跳到頁面」「找資料」「執行動作」。
兩個前端（backstage、apps/platform）都有：機制在 `@b2b-system/web-core`，內容由各 app 的 feature 登記。
側欄與帳號選單也改成由 feature 登記（§2），選單與面板讀同一份註冊表。設計決策見 §7。

---

## 1. 組成

| 位置 | 內容 |
| --- | --- |
| `web-core/navigation/` | 選單註冊表：`registerNavGroup`（分類，app 登記）、`registerNavItem`（頁面的入口，feature 登記）、`resolveNavigation`、`useNavigation` |
| `web-core/command-palette/` | `CommandPalette`（面板）、`registerSearchProvider`／`registerPaletteCommand`（資料搜尋與動作）、最近造訪（`useRecentPageStore`、`useRecentPageTracker`）、`registerCommandPalette()`（快捷鍵與頂列的搜尋按鈕） |
| `web-core/hotkey/` | 全域快捷鍵：`registerHotkey`、`useGlobalHotkeys`、`formatHotkey` |
| `web-core/route-link/hooks.ts` | `useRouteLinkChecker()`：一次判斷很多個連結能不能點（搜尋結果用） |
| `web-core/layout/DashboardShell.tsx` | 以 `useNavigation()` 渲染側欄與帳號選單的頁面；掛 `CommandPalette`、`useGlobalHotkeys()`、`useRecentPageTracker()` |
| app 的 `core/navigation/` | 側欄的分類（`NavGroupKey`、`registerNavGroups()`） |
| app 的 `app/plugin.ts` | 同步階段呼叫 `registerNavGroups()` 與 `registerCommandPalette()` |
| feature 的 `navigation.ts` | `register<Name>Navigation()`：自己頁面的入口 |
| feature 的 `search.ts`（選用） | `register<Name>Search()`：資料搜尋與動作 |

---

## 2. 選單註冊表

```ts
// app/plugin.ts → core/navigation：分類與順序是版面的決定，屬於 app
registerNavGroup({ key: 'people', labelKey: 'menu.group.people', testId: 'menu-group-people', order: 200 });

// features/user/navigation.ts：在 plugin 的同步階段登記（與 registerPagePermission 同一處）
registerNavItem({
  pageKey: USER_PAGE,
  to: '/user',
  labelKey: 'menu.user',
  testId: 'menu-user',
  icon: 'users',
  group: NavGroupKey.PEOPLE,
  order: 100,
});

// features/account/navigation.ts：帳號選單的頁面
registerNavItem({ pageKey: PROFILE_PAGE, to: '/profile', …, placement: 'account', order: 100 });
```

- 一個頁面（page key）只有一個入口；重複登記丟例外。`group` 省略時列在側欄最上方（首頁）；`placement: 'account'` 列在帳號選單，不能指定分類。
- 分類與項目各自依 `order` 排序（預留間隔，之後插在中間不必改既有的值）。
- 項目指向沒有登記的分類時，讀取（`resolveNavigation`）丟例外，不讓頁面默默從選單消失。
- 註冊表可訂閱：可啟用的 feature 安裝或卸載時，入口跟著出現或撤回（[`02-plugin-system.md`](./02-plugin-system.md) §9.2 D4）。
- 依權限過濾不在註冊表：側欄在 `SideNav`、帳號選單在 `useMenuItems`、面板在 §3 各自以 `usePageAccessChecker` 過濾（[`04-routing.md`](./04-routing.md) §9）。
- 名稱（`menu.*`）放 app 的全域語系包：側欄與面板在任何頁面都要讀得到。
- 入口的 `testId` 與搬家前相同（`menu-user`、`menu-group-people`…），E2E 不受影響。

完整性由各 app 的 `app/__tests__/navigation.test.ts` 守住：登記所有 feature 的 `permission.ts`、`navigation.ts`（backstage 另加 `search.ts`）之後，

- 每個入口的分類都存在、沒有空的分類；
- 每個入口的 `to` 經 `resolvePageKey` 落在它宣告的 page key 上（「最近造訪」與權限過濾才對得上）；
- 資料提供者與動作宣告的頁面都存在，導覽型動作的路徑落在宣告的頁面上。

---

## 3. 命令面板

### 3.1 內容

| 情況 | 分組（由上而下） |
| --- | --- |
| 沒有輸入 | 最近造訪 → 頁面（全部，選單順序） → 動作 |
| 有輸入 | 頁面（名稱比對） → 動作（名稱比對） → 每個資料提供者一組（依 `order`） |

- **比對**：以空白分詞，每個詞都要出現在翻譯後的名稱裡（不分大小寫）。頁面與動作在前端比對，資料交給提供者（後端 `ILIKE`）。
- **權限**：頁面以 page key 過濾；動作與提供者宣告了 `pageKey` 就以它過濾（進不了列表頁的人連請求都不發）；
  資料結果的 `link` 以 `useRouteLinkChecker()` 解析，解析不出來（feature 沒安裝）或目標頁進不了的那一筆不顯示。後端本來就以操作者的權限過濾列表，前端的過濾只是避免出現點了會 403 的項目。
- **空狀態**：一個分組都沒有時顯示「沒有符合的結果」。

### 3.2 資料搜尋

```
輸入 ──250 ms 防彈跳──▶ 每個提供者一個 query（TanStack Query）──▶ 各組各自顯示：搜尋中／失敗／結果
                       key = [COMMAND_PALETTE_SEARCH_QUERY_KEY, provider.key, query]
```

- 停止打字 250 ms 後才搜尋（`SEARCH_DEBOUNCE_MS`），查詢字串截到 100 字（後端 `keyword` 的上限）。
- 每個提供者一個 query，一個慢或失敗不擋其他；失敗不重試，該組顯示「搜尋失敗」。
- 查詢字串改變或面板關閉時，舊的 query 失去觀察者，TanStack Query 以 `signal` 中止請求（提供者把 `signal` 交給 fetcher）。
- `staleTime` 30 秒：刪掉一個字又打回來不必重抓。結果不經依賴圖失效（面板開著的時間很短）。
- 每個提供者最多 5 筆（`SEARCH_RESULT_LIMIT`）：面板是用來「跳過去」，要看更多就進列表頁。

### 3.3 最近造訪

- `useRecentPageTracker()`（外框掛一次）在換頁時以 `resolvePageKey(pathname)` 找出目前的頁面；有選單入口的頁面才記，子路徑（`/user/123`）算在它的頁面（使用者）底下。
- 只存 page key（`createDictStorage('commandPalette')` 的 `recentPages`，最多 5 個），名稱與路徑在讀取時從選單註冊表查；
  不存資料名稱等伺服器資料的複本（[`09-state-and-storage.md`](./09-state-and-storage.md) §4.2）。存在瀏覽器，不跨裝置。
- 列出時同樣以權限過濾：換了帳號或被拿掉權限的頁面不出現。

### 3.4 操作與可近性

- 打開時焦點在輸入框（`role="combobox"`），列表是 `role="listbox"`、分組是 `role="group"`；作用列以 `aria-activedescendant` 標示，焦點不離開輸入框。
- ↑／↓、PageUp／PageDown 移動（到底繞回），Home／End 留給輸入框移動游標；沒有移動過時 Enter 開第一個。
- 選了頁面或資料就導覽過去並關閉；執行型動作先關閉再執行。Esc 或點遮罩關閉；關閉時內容卸載，下次打開是空的輸入框。
- 面板靠上（12vh）而不是置中：結果變多變少時輸入框不會跟著上下跳。對話框的標題只給報讀器。
- 頂列的搜尋按鈕（`commandPalette` 頂列工具，偏好頁可以隱藏）的名稱帶出快捷鍵（`搜尋（⌘K）`）。

---

## 4. feature 怎麼接

```ts
// features/user/search.ts
export function registerUserSearch(): void {
  registerSearchProvider({
    key: 'user',
    labelI18nKey: 'menu.user',      // 分組標題：全域語系包
    icon: 'user',
    pageKey: USER_PAGE,             // 進不了列表頁就不搜尋
    order: 100,
    search: async (keyword, signal) => {
      const { items } = await fetchUserListQuery({
        params: { offset: 0, limit: SEARCH_RESULT_LIMIT, keyword },
        signal,
      });
      return items.map((user) => ({
        id: user.id,
        label: user.displayName,
        description: user.email,
        link: { route: 'user.detail', params: { userId: user.id } },   // route id，不是路徑
      }));
    },
  });
  registerPaletteCommand({
    key: 'user.create',
    labelI18nKey: 'commandPalette.command.createUser',
    icon: 'plus',
    pageKey: USER_CREATE_PAGE,
    order: 100,
    to: routeBasePath(UserCreateRoute),   // 或 run: () => …（在目前頁面執行）
  });
}
```

- 用自己的 `apis/` fetcher（既有的列表 API 加 `keyword` 與小 `limit`），不另開後端端點（§7.2 D3）。
- 結果以 route id 指向目標頁（[`03-feature-anatomy.md`](./03-feature-anatomy.md) §4.1），面板不 import feature 的 route；`app/__tests__/route-links.test.ts` 也收集 `{ route: '<id>' }` 字面量，打錯字或沒登記會失敗。
- 動作的名稱放 app 的全域語系包（backstage 的 `commandPalette.command.*`）。
- 可啟用的 feature（檔案、Webhook）在自己的 plugin 裡登記，租戶沒啟用時面板裡就沒有那一組。

第一批：

| app | 資料提供者（`order`） | 動作 |
| --- | --- | --- |
| backstage | 檔案（50）、使用者（100）、角色（200）、群組（300）、服務帳號（400）、Webhook（600） | 建立使用者、角色、群組、服務帳號、Webhook |
| apps/platform | — | — |

- 檔案以檔名搜尋所有進得了的資料夾（不帶 `folderId`），選了就打開檔案所在的資料夾並預覽它：資料夾裡的檔案用 `file.folderPreview`（`folder`＋`preview`），根目錄的檔案用 `file.preview`（只有 `preview`）。
- 為了讓搜尋結果連得到，角色、服務帳號新登記了 `role.detail`、`serviceAccount.detail`。
- apps/platform 目前只有頁面與最近造訪：平台的列表 API 沒有 `keyword`，之後補上時照上面的形狀加 `search.ts`。

---

## 5. 全域快捷鍵

```ts
registerHotkey({ combo: 'mod+k', allowInInput: true, run: () => … });
```

- `combo` 是 `mod+k`、`shift+/` 這種寫法；`mod` 在 macOS 是 ⌘、其他平台是 Ctrl。註冊表以「實際的按鍵組合」為鍵：macOS 上的 `mod+k` 與 `meta+k` 是同一個，重複登記丟例外（衝突偵測）。
- 焦點在輸入框、下拉選單、可編輯區時預設不觸發（使用者在打字），`allowInInput: true` 才觸發；輸入法組字中的按鍵、已被元件 `preventDefault` 的按鍵都不算。
- 命中時擋掉瀏覽器的預設行為（Chrome 的 ⌘K 是聚焦網址列）。
- 只有 `DashboardShell` 掛 `useGlobalHotkeys()`：登入前的頁面沒有快捷鍵。元件內的按鍵（燈箱的方向鍵、檔案瀏覽器的全選）照舊寫在元件裡，不進註冊表。
- 目前只有 ⌘K（再按一次關閉）。

---

## 6. 測試

| 測試 | 驗證 |
| --- | --- |
| `web-core/navigation/__tests__/registry.test.ts` | 排序、帳號選單、未登記的分類丟例外、重複登記、反註冊 |
| `web-core/hotkey/__tests__/hotkey.test.tsx` | 組合的解析與顯示、衝突偵測、輸入框內不觸發、組字中不算 |
| `web-core/command-palette/__tests__/CommandPalette.test.tsx` | 依權限過濾、最近造訪、防彈跳後才搜尋、解析不出的連結不顯示、沒權限不發請求、失敗的組、鍵盤與 Enter、執行型動作、⌘K 開關 |
| `web-core/command-palette/__tests__/recent.test.tsx` | 最近造訪的順序與上限、換頁時記錄、比對規則 |
| `web-core/layout/__tests__/DashboardShell.test.tsx` | 側欄來自註冊表、帳號選單的頁面不在側欄、反註冊後消失 |
| 各 app 的 `app/__tests__/navigation.test.ts` | §2 的完整性 |
| backstage 的 `app/__tests__/features.test.ts` | 可啟用的 feature 卸載後，入口、資料提供者、動作都撤回 |
| backstage 的 `features/{user,file}/__tests__/search.test.ts` | 搜尋的參數與結果的連結 |
| `apps/e2e/tests/command-palette.spec.ts` | ⌘K 搜尋使用者並跳到詳情、頂列按鈕與鍵盤、最近造訪、member 看不到管理項目、apps/platform 也有面板 |

---

## 7. 設計決策：全域搜尋（命令面板）

> 2026-10-07 決定並實作；原提案 `global-search`（`docs/features/`，歸檔時刪除）。

### 7.1 背景

功能變多之後，靠側邊選單找頁面、找資源越來越慢。當時：

- 側欄是兩個 app 各一份的靜態陣列（`app/layouts/navigation.ts`），列出每個 feature 的 page key、文案與圖示；新增 feature 要改 `app/`，可啟用的 feature 卸載時入口只是因為權限查不到而隱藏。
- 頁面權限註冊表只有規則與 route，沒有名稱與圖示，命令面板無從得知「有哪些頁面」。
- 沒有全域快捷鍵機制，現有的 keydown 都在元件內。
- 後端只有各列表的 `keyword`（`ILIKE`，`pg_trgm` 已啟用），沒有彙整的搜尋端點。

### 7.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **選單改成註冊表，與面板一起做**：分類由 app 登記（`core/navigation`），頁面的入口由 feature 的 `navigation.ts` 登記，側欄、帳號選單與面板讀同一份（§2）。提案的開放問題 3「要不要獨立先做」：同一個 branch、先做選單再做面板 | 面板的「頁面」需要名稱與圖示，與其另建一份清單，不如讓選單本身成為註冊表；這也是 [`02-plugin-system.md`](./02-plugin-system.md) §6 的模式，新增 feature 不必改 `app/` |
| D2 | **機制放 `@b2b-system/web-core`，兩個 app 都有**（選單、面板、快捷鍵） | 兩個前端都有側欄與頁面（[`17-shared-packages.md`](./17-shared-packages.md) §2：第二個前端也需要時放 package） |
| D3 | **資料搜尋由前端並行呼叫各 feature 的列表 API**（開放問題 1），不做彙整的 `GET /search`：250 ms 防彈跳、每個提供者一個可取消的 query、最多 5 筆 | 不必動後端，權限過濾沿用各列表；每打一個字發 N 個請求的問題由防彈跳與取消解決。要跨模組排序或資料量大時再做彙整端點（各模組登記 searcher） |
| D4 | **最近造訪存在前端**（開放問題 2），只存 page key、只記有選單入口的頁面 | 不存伺服器資料的複本（[`09-state-and-storage.md`](./09-state-and-storage.md) §4.2）；跨裝置的需求不明顯，不值得多一張表 |
| D5 | **結果以 route id 連結**，以 `useRouteLinkChecker()` 依目標頁的權限過濾 | 面板不 import feature；與站內通知的連結同一套（[`15-notification.md`](./15-notification.md) §3） |
| D6 | **全域快捷鍵的最小機制**：以實際的按鍵組合登記、衝突丟例外、預設在輸入框內不觸發（§5） | 之後加快捷鍵時有一個地方偵測衝突；打字中的單鍵不能被攔走 |
| D7 | **動作只做「前往某一頁」與「在目前頁面執行」**，第一批是各列表的「建立」 | 最常見的捷徑；更複雜的動作（帶參數、多步驟）等有需求再設計 |

不做（這一版）：全文檢索引擎、附件內容搜尋、跨租戶搜尋、跨裝置的最近造訪、apps/platform 的資料搜尋（平台的列表 API 沒有 `keyword`）。

### 7.3 評估過的方案

- **彙整端點 `GET /search`**：一個請求、可以跨模組排序，但要各模組再登記一份 searcher 與可見性判斷；以目前的資料量與 `limit 5`，並行呼叫的延遲足夠。
- **面板放 backstage 的 `core/`、之後再搬**（提案的寫法）：apps/platform 同樣有側欄與頁面，一開始就放 web-core 免得搬第二次。
- **最近造訪記到資料層級**（「使用者：王小明」）：要存名稱就是伺服器資料的複本，不存名稱又只剩 id 可顯示。
- **面板的列表用 `Select` 的 `searchable`**：`Select` 是彈出式的，面板要的是對話框裡常駐的列表、分組標題與兩行的選項；改用 `useListNavigation`（`@b2b-system/ui/VirtualList`）自己組。結果最多幾十筆，不需要虛擬捲動。

### 7.4 實作紀錄

| 項目 | 補充 |
| --- | --- |
| D1 | 入口的 `testId` 沿用搬家前的值；帳號選單的入口多了 `testId`（`menu-profile`、`menu-preference`），目前沒有畫面用到 |
| D1 | `DashboardShell` 的 `navTopItems`、`navGroups`、`accountPages` 參數拿掉，兩個 app 的 `app/layouts/navigation.ts` 刪除 |
| D3 | 檔案搜尋要能打開檔案所在的資料夾，`file.folder` 之外多登記 `file.preview`、`file.folderPreview`（route id 的參數都是必要的，根目錄的檔案沒有資料夾，所以分兩個） |
| D5 | `app/__tests__/route-links.test.ts` 多收集 `{ route: '<route id>' }` 形式的字面量（只收格式像 route id 的，`{ route: 'GET /users' }` 之類不算） |

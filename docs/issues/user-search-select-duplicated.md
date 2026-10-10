# 使用者搜尋下拉與輸入去抖動各自實作

## 現況

「在伺服器端搜尋使用者」的下拉選單在 backstage 有 5 份幾乎相同的實作，每份都自己寫一次 250 ms 的去抖動、
`getUserListQueryOptions({ params: { offset: 0, limit: 20, keyword } })`、把使用者換成 `{ value, label: displayName, description: email }`
（路徑相對 `apps/backstage/src/features/`）：

| 位置 | 去抖動 | 查詢 | 差異 |
| --- | --- | --- | --- |
| `approval-flow/components/UserSearchSelect.tsx:9`、`:34-38`、`:40-53` | `USER_SEARCH_DEBOUNCE_MS = 250` | 有 `enabled: !disabled` | 目前的值不在結果裡時以 `selectedLabel` 補一個選項 |
| `organization/pages/Organization/components/OrgUnitMemberSection.tsx:30`、`:220-235`（`AddMemberRow`） | 同上 | 沒有 `enabled` | 無 |
| `group/pages/GroupDetail/components/GroupMemberSection.tsx:25`、`:124-145`（`AddMemberRow`） | 同上 | `enabled: type === 'user'` | 另有「群組」種類 |
| `notification/pages/NotificationOverview/components/RecipientSelect.tsx:10`、`:24-50` | 同上 | 沒有 `enabled` | 目前的值不在結果裡時另發 `getUserDetailQueryOptions` 補名稱 |
| `announcement/components/AudiencePicker.tsx:18`、`:34-62` | 同上 | 沒有 `enabled` | 多選；已選的使用者逐一 `getUserDetailQueryOptions` 補名稱 |

同樣的「`useState` ＋ `useEffect(setTimeout)`」去抖動另有 2 份（搜尋的是檔案授權對象，不是使用者列表）：

- `file/pages/FileManager/components/FileAccessExplainSection.tsx:15`、`:39-42`
- `file/pages/FileManager/components/FileGrantAddRow.tsx:23`、`:46-49`

`packages/web-core/src/command-palette/useDataSearch.ts:14-21` 已經有通用的 `useDebouncedValue(value, delayMs)`，
但 `command-palette/index.ts` 沒有匯出它（只給同模組的 `usePaletteSections.ts:73` 用），而且它放在命令面板模組裡，語意上也不是給別人用的位置。

「目前的值不在搜尋結果裡就補一個選項」的作法也不一致：`UserSearchSelect` 用呼叫端傳入的 `selectedLabel`、`RecipientSelect` 與 `AudiencePicker` 另發詳情查詢、
`OrgUnitMemberSection`／`GroupMemberSection` 不處理（加入後就清空，所以不需要）。

## 影響

- 改一個行為（例：去抖動時間、每頁筆數、`description` 改顯示帳號、加 `keepPreviousData` 避免結果閃爍）要改 5 處，容易漏。
- `enabled` 的條件各自決定：`OrgUnitMemberSection`、`RecipientSelect`、`AudiencePicker` 在下拉還沒打開時就查一次使用者列表。
- 新的表單需要選使用者時，最自然的作法是再複製一份。

嚴重度低：開發體驗與程式整潔，目前各處行為都正確。

## 修正方式

依 `docs/coding-standards/07-layer-dependencies.md` §2.2，backstage 的 `core/` 不能 import `apis/`，`features/` 之間也不能互相 import，所以分兩層：

1. **去抖動搬到 `packages/web-shared/src/hooks/`**（純 React hook，兩個前端與 web-core 都能用）：
   `useDebouncedValue` 從 `web-core/command-palette/useDataSearch.ts` 搬過去並由 `@b2b-system/web-shared/hooks` 匯出，
   `usePaletteSections.ts` 改 import 它；上面 7 處的 `useState`＋`useEffect` 換成 `const debounced = useDebouncedValue(keyword.trim(), 250)`。
2. **使用者搜尋選單放 backstage 的 `core/components/UserSearchSelect/`**（只有 backstage 有租戶使用者，依 CLAUDE.md 不進 package）。
   與 `core/components/OrgUnitPicker` 相同，資料由呼叫端注入：props 收 `queryOptions: (keyword) => UseQueryOptions<UserList>`
   （呼叫端傳 `(keyword) => getUserListQueryOptions({ params: { offset: 0, limit: 20, keyword } })`）、`resolveSelected`（補名稱的查詢，選用）、
   `multiple`、`enabled` 與所有文字；元件內處理去抖動、`filterOption={false}`、選項轉換、目前的值不在結果裡時的補位。
3. 五個呼叫端改用它；`GroupMemberSection` 的「群組」種類維持本地過濾，只有「使用者」種類換成新元件。
   `approval-flow/components/UserSearchSelect.tsx` 刪除（它是目前最完整的一份，可以當成搬移的起點）。
4. 檔案授權對象的兩處（`FileAccessExplainSection`、`FileGrantAddRow`）只套第 1 步，查詢不同不必併進第 2 步的元件。

## 驗證方式

- `packages/web-shared` 補 `useDebouncedValue` 的測試（fake timers：連續改值只在停頓後更新一次）；web-core 命令面板的既有測試照常通過。
- `core/components/UserSearchSelect/__tests__/`：打字後只在停頓後查詢一次、結果轉成選項、目前的值不在結果裡時補位、`enabled: false` 時不查詢。
- 既有的 `GroupMemberSection`、`OrgUnitMemberSection`、`RecipientSelect`、`AudiencePicker`、審批流程編輯頁的測試全部通過；`pnpm typecheck`、`pnpm lint`。
- `grep -rn "USER_SEARCH_DEBOUNCE_MS" apps/backstage/src` 沒有結果。

（2026-10-10 backstage 各功能的優化分析發現。）

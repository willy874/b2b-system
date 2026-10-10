# 列表頁的頁首、匯出／匯入按鈕、展開列與審批表格欄位各自複製

## 現況

幾段小的 UI 在 backstage 各頁複製（路徑相對 `apps/backstage/src/features/`）。

**1. 匯出／匯入按鈕**：8 個列表頁、13 個按鈕，都是「`Button`（`download`／`upload` 圖示）＋ 權限判斷」，有多種資源時包一層 `Menu`（`chevron-down`）：

| 頁面 | 匯出 | 匯入 | 形狀 |
| --- | --- | --- | --- |
| `approval/pages/ApprovalList/page.tsx` | `:115-144` | — | `Menu`（申請、決定） |
| `organization/pages/Organization/page.tsx` | `:81-108` | `:109-147` | 兩個都是 `Menu` |
| `group/pages/GroupList/page.tsx` | `:61-` | `:89-` | 兩個都是 `Menu` |
| `role/pages/RoleList/page.tsx` | `:95-104` | `:105-115` | `Button` ＋ `ButtonLink` |
| `user/pages/UserList/page.tsx` | `:145-` | `:155-` | `Button` ＋ `ButtonLink` |
| `tag/pages/TagList/page.tsx` | `:75-` | `:85-` | `Button` ＋ `ButtonLink` |
| `service-account/pages/ServiceAccountList/page.tsx` | `:53-` | — | `Button` |
| `audit-log/pages/AuditLogList/page.tsx` | `:97-` | — | `Button` |

權限的判斷也不一致：organization 寫 `permission.hydrated && permission.canExport`，其他頁只看 `permission.canExport`
（例：`role/hooks/useRolePermission.ts:34` 的 `canExport` 不含 `hydrated`）。

**2. 單列展開**：`packages/web-core/src/job/useExpandedJob.ts:4-14`（`useExpandedJob`：一次只展開一列、點同一列收合）與
`audit-log/pages/AuditLogList/page.tsx:40`、`:45-48`（`useState` ＋ `useCallback` 同一段邏輯），apps/platform 的 `audit-log/pages/AuditLogList/page.tsx:36-39` 也一份。
web-core 的版本名稱綁在「job」，稽核頁因此沒有用它。

**3. 審批表格的欄位**：`approval/pages/MyApprovalList/page.tsx:56-109` 與 `approval/pages/ApprovalList/components/ApprovalTable.tsx:76-149`
有 5 個相同的欄位定義（類型連結、申請人、進度、狀態 `Chip`、建立時間），只差連結的目標路由與 testid 前綴。
`MyApprovalList/page.tsx:25` 還從另一個頁面的資料夾 import `../ApprovalList/components/ApprovalProgress`。

**4. 頁首**：backstage 有 31 個 `<h1>`，其中 30 個是同一段
`<header><h1 className="m-0 text-xl font-semibold">…</h1><p className="mt-1 text-sm text-[var(--color-fg-muted)]">…</p></header>`
（另一個是 `gallery/pages/Gallery/components/GalleryHeader.tsx:37`，多了 `truncate`）；apps/platform 與 web-core 另有 14 個。
web-core 已有一個只給背景工作頁用的 `packages/web-core/src/job/JobPageHeader.tsx`。

右側有按鈕的列表頁頁首用 `flex items-center justify-between gap-4`，**沒有 `flex-wrap`**，12 處：
`organization/pages/Organization/page.tsx:73`、`webhook/pages/WebhookList/page.tsx:41`、`role/pages/RoleList/page.tsx:89`、`group/pages/GroupList/page.tsx:55`、
`notification/pages/NotificationList/page.tsx:38`、`audit-log/pages/AuditLogList/page.tsx:90`、`user/pages/UserList/page.tsx:139`、
`service-account/pages/ServiceAccountList/page.tsx:45`、`announcement/pages/AnnouncementList/page.tsx:38`、`tag/pages/TagList/page.tsx:67`、
`approval/pages/ApprovalList/page.tsx:108`、`identity-provider/pages/IdentityProviderList/page.tsx:134`。
較新的頁首都有加（`file/pages/FileManager/components/FileManagerHeader.tsx:8`、`gallery/pages/Gallery/components/GalleryHeader.tsx:35`、
`approval-flow/pages/ApprovalFlowEdit/components/FlowEditHeader.tsx:41`、`organization/pages/Organization/components/OrgUnitDetailPanel.tsx:61`）。

## 影響

- 窄螢幕或側欄展開時，使用者、組織、群組這類右側有 3～4 個按鈕（匯出、匯入、建立）的頁首會擠壓標題或水平溢出；較新的頁首不會，行為不一致。
- 調整頁首的字級、間距或匯出按鈕的樣式要改三十幾處；新頁面照抄時容易漏掉 `flex-wrap`，`hydrated` 要不要判斷也沒有一致的作法。
- 審批的兩個表格改一個欄位（例：類型的顯示方式）要改兩處。

嚴重度低：開發體驗與一致性；溢出只在窄寬度出現，功能仍可用。

## 修正方式

依「兩個前端都用 → packages；只有 backstage → app 的 `core/`；只有一個 feature → feature 的 `components/`」分四步，可以分開做：

1. **頁首（packages/ui）**：`@b2b-system/ui/PageHeader`（`title`、`description`、`actions`；`flex flex-wrap items-start justify-between gap-3`，標題可 `truncate`）。
   沒有業務名詞，放設計系統（照 `packages/ui` 的規定附測試與 story）；`web-core/job/JobPageHeader` 改用它，兩個 app 的頁首逐頁替換。
   這一步同時修掉上面 12 處沒有 `flex-wrap` 的問題。
2. **單列展開（packages/web-shared）**：`useExpandedJob` 改名為通用的 `useSingleExpanded`，搬到 `packages/web-shared/src/hooks/`，
   web-core 的背景工作頁、兩個 app 的稽核頁都用它。
3. **匯出／匯入按鈕（backstage `core/components/`）**：只有 backstage 有匯出匯入的列表頁，放 `core/components/TransferActions/`：
   `exportOptions: Array<{ key, label, onSelect }>`、`importOptions`（一項時渲染成按鈕、多項時渲染成 `Menu`）與 testid 前綴；權限由呼叫端決定傳不傳。
   文字鍵 `dataTransfer.export.action`／`dataTransfer.import.action` 在 web-core 的共用語系包，元件可直接使用。
4. **審批表格（feature 內）**：`approval/components/approvalColumns.tsx` 匯出共用的欄位工廠（收「詳情連結的 route 與 search」與 testid 前綴），
   `MyApprovalList` 與 `ApprovalTable` 都用它；`ApprovalProgress` 一併搬到 `approval/components/`。

## 驗證方式

- 新元件／hook 各自的單元測試（`PageHeader` 的 actions 換行、`useSingleExpanded` 的切換、`TransferActions` 的一項／多項兩種形狀）。
- 既有頁面測試與 E2E 通過（testid 維持原名）；`pnpm --filter @b2b-system/e2e tour` 重拍後比對列表頁截圖沒有版面變化。
- 手動：把視窗縮到 768 px、側欄展開，使用者、組織、群組列表的頁首按鈕換到第二行而不是溢出。
- `grep -rn 'className="m-0 text-xl font-semibold"' apps/*/src` 沒有結果。

（2026-10-10 backstage 各功能的優化分析發現。）

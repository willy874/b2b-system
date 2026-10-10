# backstage 有頁面與 hook 沒有測試，E2E 只跑 Chromium

## 現況

`docs/coding-standards/04-testing.md` §4 規定「新增頁面 → 頁面的三個權限案例」「新增 feature hook → hook 測試」；
`docs/architecture/frontend/10-testing.md` §1 要求每個受權限影響的 UI 元素都有「有權限」與「無權限」兩案，第三案是未水合（`renderUnhydrated`，§3）。
掃 `apps/backstage/src/features/*/pages/*/` 與 `features/*/hooks/`，以下沒有對應的測試（路徑相對 `apps/backstage/src/features/`）。

（2026-10-10 已補：`SystemIndex`、`GroupCreate`、`ServiceAccountCreate`、`GroupMemberImport`、`OrgUnitMemberImport` 的頁面測試；
圖片庫的 `batchRuns`、`useGalleryMutations`、`useGalleryUpload`、`useResolveAlbum`。）

**1. 沒有任何頁面層級測試的頁面**

| 頁面 | 行數 | 受權限影響的部分 | 現有的間接覆蓋 |
| --- | --- | --- | --- |
| `approval/pages/ApprovalDetail/page.tsx`、`approval/pages/MyApprovalDetail/page.tsx` | 34、34 | 兩頁都只包 `components/ApprovalDetailView.tsx`；`__tests__/` 只測審核表單與動作元件（`ApprovalReview.test.tsx`、`ApprovalChainActions.test.tsx`），沒有渲染整個詳情 | E2E |
| `file/pages/FileManager/page.tsx` | — | 頁面本身沒有渲染測試；`__tests__/` 有 20 個元件與 hook 測試，`useFileManagerItems.test.tsx` 以 `renderHook` 組合頁面的資料流 | E2E |
| `home/pages/Home/page.tsx` | 47 | 不受權限影響（顯示自己的資料與 `HomeSections`），三案不適用，但沒有任何渲染測試 | 無 |

**2. 沒有單元測試的 hook 與批次操作**

各 feature 沒被任何測試引用的 hook（以匯出的函式名稱在 `*.test.ts(x)` 中搜尋）：

- mutation：`approval-flow/hooks/useApprovalFlowMutations.ts`、`tag/hooks/useTagMutations.ts`、`file/hooks/useFileTagsMutation.ts`、
  `system/hooks/useUpdateSettingsMutation.ts`、`notification/hooks/useUpdateNotificationEventsMutation.ts`、`notification/hooks/useUpdateNotificationPreferencesMutation.ts`、
  `notification/hooks/useDeleteNotification.ts`、`auth/hooks/useRetryLogoutMutation.ts`、`auth/hooks/useSsoCallbackMutation.ts`
- 權限 hook：`approval-flow/hooks/useApprovalFlowPermission.ts`、`group/hooks/useGroupPermission.ts`、`identity-provider/hooks/useIdentityProviderPermission.ts`、
  `notification/hooks/useNotificationEventPermission.ts`、`system/hooks/useSettingPermission.ts`、`file/hooks/useFileExplainPermission.ts`
- 其他：`approval/hooks/useApprovalCounts.ts`、`comment/hooks/useComments.ts`、`comment/hooks/useMentionableUsers.ts`、`file/hooks/useFileUpload.ts`、
  `organization/hooks/useOrgChartEditor.ts`、`permission/hooks/useFilteredPermissionCatalog.ts`、`permission/hooks/usePermissionCatalogTree.ts`、
  `role/hooks/useGrantablePermissions.ts`、`role/hooks/usePermissionSkillTree.ts`、`user/hooks/useUserCreateForm.ts`、`user/hooks/useUserIdentities.ts`、
  `webhook/hooks/useWebhookUrlCapacity.ts`
- 批次操作：`approval/batch.ts`、`role/batch.ts` 的 `register*BatchOperations` 沒有測試（`file`、`notification` 有）。

部分 hook 會在頁面測試裡被間接執行，但失效範圍、錯誤分支這類細節頁面測試不會驗證。

**3. E2E 只跑桌面版 Chromium**

- `apps/e2e/playwright.config.ts:22`：`projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]`。
- `docs/guide/introduction/01-overview.md:183` 寫明支援「最新兩個版本的 Chrome、Edge、Firefox、Safari」，Firefox 與 Safari（WebKit）沒有任何自動化測試。
  有瀏覽器差異風險的功能：WebAuthn（Safari 要求在點擊裡呼叫，`docs/architecture/frontend/20-mfa.md`）、資料夾上傳（`webkitdirectory`、`webkitGetAsEntry`）、
  `BroadcastChannel`／IndexedDB（批次佇列跨分頁接手）、檢視器的全螢幕 API。

## 影響

- 審批詳情只有元件測試，返回鈕的去向與「待我審核」的 `queue` 只靠 E2E；hook 的失效範圍、錯誤分支不會被頁面測試驗到。
- Safari／Firefox 特有的問題只能靠使用者回報。

嚴重度低：目前沒有已知的錯誤，是測試覆蓋的缺口。

## 修正方式

都在各 feature 的 `__tests__/` 補，不需要新的共用程式（測試輔助已在 `@b2b-system/web-core/testing`）。依序：

1. **頁面測試**（每頁一個 `__tests__/<Page>Page.test.tsx`，用 `renderRoute`／`renderWithPermissions`／`renderUnhydrated`）：
   - `ApprovalDetail`／`MyApprovalDetail`：渲染 `ApprovalDetailView`，驗證返回鈕的去向與「待我審核」時的 `queue`。
   - `FileManager`、`Home`：至少一個渲染的冒煙測試。
2. **其他 hook**：優先 mutation 類（失效範圍與錯誤處理），權限 hook 可以併進該 feature 的頁面測試以三案覆蓋。
3. **E2E 的瀏覽器**：`playwright.config.ts` 加 `firefox` 與 `webkit` project，但只跑標了 `@cross-browser` 的少數流程（登入、MFA、檔案上傳、批次佇列），
   在每日排程跑、不擋 PR（`docs/architecture/frontend/10-testing.md` §1 的 E2E 本來就是「PR ＋ 每日」）；WebAuthn 以 Playwright 的虛擬驗證器測 Chromium，Safari 的點擊限制以手動檢查清單補。
   `10-testing.md` 補一節說明跨瀏覽器的範圍。

## 驗證方式

- 新增的測試都能通過，並各自以「改壞對應的程式會失敗」確認有效。
- `pnpm --filter @b2b-system/backstage test` 通過；重跑本文件的掃描（`pages/*/` 沒有 `__tests__` 的資料夾、`hooks/` 的匯出函式在測試中沒有出現）只剩刻意不測的項目。
- `pnpm test:e2e --project=firefox --project=webkit --grep @cross-browser` 在本機與 CI 的每日排程通過。

（2026-10-10 backstage 各功能的優化分析發現。）

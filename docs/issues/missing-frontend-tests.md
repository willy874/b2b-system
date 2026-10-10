# backstage 有頁面與 hook 沒有測試，E2E 只跑 Chromium

## 現況

`docs/coding-standards/04-testing.md` §4 規定「新增頁面 → 頁面的三個權限案例」「新增 feature hook → hook 測試」；
`docs/architecture/frontend/10-testing.md` §1 要求每個受權限影響的 UI 元素都有「有權限」與「無權限」兩案，第三案是未水合（`renderUnhydrated`，§3）。
掃 `apps/backstage/src/features/*/pages/*/` 與 `features/*/hooks/`，以下沒有對應的測試（路徑相對 `apps/backstage/src/features/`）。

**1. 沒有任何頁面層級測試的頁面**

| 頁面 | 行數 | 受權限影響的部分 | 現有的間接覆蓋 |
| --- | --- | --- | --- |
| `group/pages/GroupCreate/page.tsx` | 145 | 頁面權限 `group:create`、成功後前往詳情 | E2E `apps/e2e/tests/group.spec.ts` |
| `service-account/pages/ServiceAccountCreate/page.tsx` | 116 | `canReadRoles`（`:29-32`、`:98`）決定角色欄是否出現與是否查詢 | E2E `apps/e2e/tests/api-token.spec.ts` |
| `group/pages/GroupMemberImport/page.tsx` | 51 | 匯入權限 | 無 |
| `organization/pages/OrgUnitMemberImport/page.tsx` | 53 | 匯入權限 | 無 |
| `system/pages/SystemIndex/page.tsx` | 35 | 等權限水合與 feature 清單都到才導向第一個看得到的分頁、沒有分頁時顯示空狀態 | 無 |
| `approval/pages/ApprovalDetail/page.tsx`、`approval/pages/MyApprovalDetail/page.tsx` | 34、34 | 兩頁都只包 `components/ApprovalDetailView.tsx`；`__tests__/` 只測審核表單與動作元件（`ApprovalReview.test.tsx`、`ApprovalChainActions.test.tsx`），沒有渲染整個詳情 | E2E |
| `file/pages/FileManager/page.tsx` | — | 頁面本身沒有渲染測試；`__tests__/` 有 20 個元件與 hook 測試，`useFileManagerItems.test.tsx` 以 `renderHook` 組合頁面的資料流 | E2E |
| `home/pages/Home/page.tsx` | 47 | 不受權限影響（顯示自己的資料與 `HomeSections`），三案不適用，但沒有任何渲染測試 | 無 |

**2. 沒有單元測試的 hook 與批次操作**

圖片庫最明顯：`gallery/hooks/` 只有 `useGalleryPermission` 有測試。

- `gallery/hooks/useGalleryMutations.ts`（214 行、12 個 mutation hook）、`gallery/hooks/useGalleryUpload.ts`（73 行）、`gallery/hooks/useResolveAlbum.ts`。
- `gallery/batch.ts`（157 行）：只有 `pairedItemId` 在 `gallery/__tests__/helpers.test.ts:105-111` 測到；`runUpload`、刪除、貼標籤的批次操作沒有測試。
  對照 `file/__tests__/batch.test.ts` 有 10 個案例（取不到暫存檔、限流保留、成功與失敗都重抓用量、刪除的失效範圍）。

其他 feature 也有沒被任何測試引用的 hook（以匯出的函式名稱在 `*.test.ts(x)` 中搜尋）：

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

- 沒有頁面測試的頁面，權限 gating（例：服務帳號建立頁沒有 `role:read` 時角色欄的處理、`SystemIndex` 在水合前不能導向錯的分頁）只靠 E2E 或完全沒有保護；
  `SystemIndex` 的「等 feature 清單到了才導向」是為了避開檔頭註解描述的錯誤導向，沒有測試保護，改動時容易再出現。
- 圖片庫的上傳批次與 mutation 的快取失效沒有測試，改 `core/upload` 或 `apis/resources.ts` 時不會有測試失敗。
- Safari／Firefox 特有的問題只能靠使用者回報。

嚴重度低：目前沒有已知的錯誤，是測試覆蓋的缺口；`SystemIndex` 與圖片庫 `batch.ts` 建議先補。

## 修正方式

都在各 feature 的 `__tests__/` 補，不需要新的共用程式（測試輔助已在 `@b2b-system/web-core/testing`）。依序：

1. **頁面測試**（每頁一個 `__tests__/<Page>Page.test.tsx`，用 `renderRoute`／`renderWithPermissions`／`renderUnhydrated`）：
   - `SystemIndex`：水合前與 feature 清單未到時顯示骨架、不導向；到齊後導向第一個看得到的分頁；沒有任何分頁時顯示 `system-settings-empty`。
   - `GroupCreate`、`ServiceAccountCreate`：有權限、無權限（頁面權限 403）、未水合三案；服務帳號另測沒有 `role:read` 時不查角色、不顯示角色欄。
   - `GroupMemberImport`、`OrgUnitMemberImport`：三個權限案例；可以參照 `user/pages/UserImport/__tests__/`。
   - `ApprovalDetail`／`MyApprovalDetail`：渲染 `ApprovalDetailView`，驗證返回鈕的去向與「待我審核」時的 `queue`。
   - `FileManager`、`Home`：至少一個渲染的冒煙測試。
2. **圖片庫**：`gallery/__tests__/batch.test.ts`（比照 `file/__tests__/batch.test.ts` 的上傳、限流、刪除、貼標籤案例）、
   `gallery/hooks/__tests__/useGalleryMutations.test.tsx`（每個 mutation 的失效範圍）、`useGalleryUpload.test.tsx`、`useResolveAlbum.test.tsx`。
   上傳的共通案例已由 `core/upload` 的 runner 測試涵蓋（`createUploadRunner`），這裡只測圖片庫特有的部分。
3. **其他 hook**：優先 mutation 類（失效範圍與錯誤處理），權限 hook 可以併進該 feature 的頁面測試以三案覆蓋。
4. **E2E 的瀏覽器**：`playwright.config.ts` 加 `firefox` 與 `webkit` project，但只跑標了 `@cross-browser` 的少數流程（登入、MFA、檔案上傳、批次佇列），
   在每日排程跑、不擋 PR（`docs/architecture/frontend/10-testing.md` §1 的 E2E 本來就是「PR ＋ 每日」）；WebAuthn 以 Playwright 的虛擬驗證器測 Chromium，Safari 的點擊限制以手動檢查清單補。
   `10-testing.md` 補一節說明跨瀏覽器的範圍。

## 驗證方式

- 新增的測試都能通過，並各自以「改壞對應的程式（例：拿掉 `SystemIndex` 的 `featuresResolved` 判斷）會失敗」確認有效。
- `pnpm --filter @b2b-system/backstage test` 通過；重跑本文件的掃描（`pages/*/` 沒有 `__tests__` 的資料夾、`hooks/` 的匯出函式在測試中沒有出現）只剩刻意不測的項目。
- `pnpm test:e2e --project=firefox --project=webkit --grep @cross-browser` 在本機與 CI 的每日排程通過。

（2026-10-10 backstage 各功能的優化分析發現。）

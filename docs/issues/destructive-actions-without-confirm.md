# 移除群組成員、移除資料夾授權、在對話框駁回審批、停用平台管理者，都沒有確認

## 現況

同類的刪除與停用都先用 `useConfirm` 確認，並說明影響，例：

- 停用使用者：`apps/backstage/src/features/user/pages/UserDetail/components/UserBasicSection.tsx` L95–110，文案「對方會立即被登出」。
- 列表上的快速駁回：`apps/backstage/src/features/approval/pages/ApprovalList/components/ApprovalRowActions.tsx` L68–80。

下列操作點一下就生效：

1. 移除群組成員：`apps/backstage/src/features/group/pages/GroupDetail/components/GroupMemberSection.tsx`
   - 「×」鈕（L83）直接呼叫 `remove()`（L37–40）送出。
   - 成員可以是巢狀群組。移除一個子群組，裡面所有人都會失去這個群組帶來的角色。
   - 沒有復原。
2. 資料夾授權：`apps/backstage/src/features/file/pages/FileManager/components/FileShareDialog.tsx` 的 `GrantRow`
   - 「移除」（L418）立即生效。對象可以是角色、群組或「所有人」。
   - 變更等級（L401–409）選了就送出，降級也一樣。
3. 審批詳情的「駁回」：`apps/backstage/src/features/approval/pages/ApprovalDetail/components/ApprovalReviewActions.tsx` L22–30 直接送出。
   - 同一個操作在列表上有確認。
   - 駁回後無法撤回：後端會寄結果信、通知申請人、送出 `approval.decided` 事件（`apps/api/src/modules/approval/approval.service.ts` L257–259）。
4. 停用或降級平台管理者：`apps/platform/src/features/platform-admin/pages/PlatformAdminList/components/EditPlatformAdminDialog.tsx` 的 `submit()`（L57–75）直接送出。
   - 停用時後端會撤銷對方所有 session，並推播把他登出（`apps/api/src/modules/platform-admin/platform-admin-management.service.ts` L112–113、L135–139）。
   - backstage 停用使用者有確認，platform 沒有，兩邊不一致。

## 影響

- 誤點一下就讓一群人失去角色或資料夾的存取，畫面也沒有說明影響範圍。
- 審核者誤按「駁回」無法挽回，申請人已經收到結果。
- 平台管理者誤停用同事，會立刻把對方登出。

## 修正方式

一律用 `useConfirm`（`tone: 'danger'`），文案說明影響：

1. 群組成員：「移除後，〔名稱〕不再取得這個群組的角色。」成員是群組時加上「其中的成員也一樣」。
2. 資料夾授權：移除與降級都要確認。對象是「所有人」或群組時，說明影響的是一群人。
3. 審批詳情的駁回：沿用 `approval.quickReject.*` 的確認文案。
4. 平台管理者：狀態改成停用、或角色降級時確認，文案比照 `user.deactivate.confirm`。

## 驗證方式

每個元件補：點擊 → 出現確認 → 按取消時不送出請求；按確認後才送出。

- 群組成員：`apps/backstage/src/features/group/pages/GroupDetail/__tests__/GroupDetailPage.test.tsx`
- 資料夾授權：`apps/backstage/src/features/file/pages/FileManager/__tests__/FileShareDialog.test.tsx`
- 審批駁回：`apps/backstage/src/features/approval/pages/ApprovalDetail/__tests__/ApprovalReview.test.tsx`
- 平台管理者：`apps/platform/src/features/platform-admin/pages/PlatformAdminList/__tests__/PlatformAdminListPage.test.tsx`

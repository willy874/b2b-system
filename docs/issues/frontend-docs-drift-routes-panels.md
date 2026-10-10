# 前端規格與實作的落差：路由樹、審批詳情、留言面板

## 現況

三處規格描述的是舊的或不存在的實作：

1. **路由樹列了不存在的路由**：`docs/architecture/frontend/04-routing.md` 第 38、43、45 行的
   `UserDetailRoleRoute`（角色指派子頁）、`RoleCopyRoute`、`RoleDetailCopyRoute`，在 `apps/backstage/src` 裡都找不到
   （複製角色現在是 `features/role/hooks/useRoleMutations.ts` 的 mutation，從角色詳情呼叫）。
2. **審批詳情仍寫成對話框**：`docs/architecture/iam/02-permission-catalog.md` 第 443–444 行寫
   「含 `/approval/$approvalId` 對話框」「含 `/my-approvals/$approvalId` 對話框」。審批詳情已改成整頁
   （`apps/backstage/src/features/approval/routes/pages.ts` 第 29–31、51 行；`docs/architecture/backend/20-approval.md` §11.3）。
3. **留言面板的掛載表只列使用者詳情**：`docs/architecture/frontend/22-comment.md` 第 37 行的表格只有
   「使用者詳情」。程式裡還有審批詳情（`features/approval/pages/ApprovalDetail/components/ApprovalDetailView.tsx`）
   與圖片庫的資訊面板（`features/gallery/pages/Gallery/components/GalleryInfoPanel.tsx`）也放了 `<ResourcePanels>`。

## 影響

讀規格的人會去找不存在的路由，或以為審批詳情是列表上的對話框（影響權限頁面的註冊與 E2E 的寫法）；
新增可留言的資源時，不知道有哪些頁面已經掛了面板。

嚴重度低：只影響文件的正確性，不影響行為。

## 修正方式

1. `04-routing.md` §2 的路由樹：刪掉這三個路由，補上現在的結構（審批詳情、使用者匯入等掛在 RootRoute 下的整頁）。
2. `02-permission-catalog.md` 第 443–444 行：改成「`/approval/$approvalId` 整頁詳情」。
3. `22-comment.md` §2 的表格：補上審批詳情與圖片庫資訊面板兩列（位置、面板順序）。

## 驗證方式

- 文件修正，不需要測試。修完後 grep `RoleCopyRoute|RoleDetailCopyRoute|UserDetailRoleRoute` 在 `docs/` 沒有結果；
  grep `ResourcePanels` 在 `apps/backstage/src/features` 的使用處都出現在 `22-comment.md` 的表格裡。

（2026-10-10 backstage 各功能的優化分析發現。）

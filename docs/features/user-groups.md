# 使用者群組

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md)、[`../architecture/04-sso.md`](../architecture/04-sso.md) §11（外部 IdP 的群組對應）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

資料夾授權的對象目前是 `role`、`user`、`everyone` 三種（`resource_grants.subject_type`）。
角色帶權限，拿來當分組會讓角色數量爆炸（「美術組-A 專案」「美術組-B 專案」…）；逐個使用者授權則難以維護。
群組是「不帶權限、純分組」的概念：授權給群組，人員異動只改群組成員。

租戶實體隔離（[ADR-0020](../adr/0020-physical-tenant-isolation.md)）之後，工作區角色已取消，每個租戶的角色、使用者都在自己的 DB，
所以群組也一定是 **租戶內** 的。一個租戶內的人數仍可能到上千，分組的需求沒有消失。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 群組 CRUD、成員管理（租戶 DB） | 巢狀群組 |
| 群組當作資源授權的對象（`subject_type` 加 `group`） | 群組直接帶角色（見開放問題 1） |
| 授權對象選擇器（`grant-subjects`）列出群組 | 從外部 IdP 同步群組（連線的群組對應是另一件事） |

## 初步構想

- 資料：`groups`（`name`、`description`、`deleted_at`，名稱唯一用 partial index）、`group_members`（`group_id`、`user_id`）。
- 資源授權：`grant_subject_type` enum 加 `group`（要 `ALTER TYPE` 的 migration）；
  `resource-grant.resolver.ts` 解析使用者生效的授權時，一併帶入他所屬群組的授權。
- 快取：資料夾授權目前每次請求依 `grantsFor(actor)` 查詢，沒有權限快取；群組成員變更只要讓 `FileFolderTree` 與推播的受眾更新
  （`fileFolder` 的推播受眾要加上群組成員）。
- 權限：`group:read`、`group:create`、`group:update`、`group:delete`；稽核 `group.*`、`group.member.add`／`remove`。
- 前端：`features/group/`，使用者詳情頁顯示所屬群組。

## 開放問題

1. 群組要不要也能被指派角色（「美術組的人都有 member ＋ 上傳權限」）？要的話會動到 `PermissionService` 的權限解析與權限快取（`{tenantId}:{userId}`）
   的失效範圍：群組成員或群組的角色變更時，要讓所有成員的快取失效。
2. 群組的管理權限要不要下放（群組擁有者可以管自己的群組成員）？
3. 等外部 IdP 的群組對應（`04-sso.md` §11）做的時候，是對應到角色還是對應到群組？

## 歸檔去向

- `docs/rbac/01-domain-model.md`、`docs/rbac/07-resource-grants.md` §1
- `docs/rbac/02-permission-catalog.md`

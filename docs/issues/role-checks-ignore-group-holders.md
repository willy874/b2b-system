# 角色的自我鎖定、使用中與推播只看直接持有者，經由群組持有角色的人被漏掉

## 現況

群組可以持有角色（`role:<r>#holder@group:<g>#member`），[`rbac/08-groups.md`](../rbac/08-groups.md) §1 的定義是「g 的成員都持有 r」。
以下幾個地方仍只認直接持有的邊：`isRoleHolderTuple()`，條件是 `subject_type = 'user'`（`apps/api/src/db/schema/relation-tuples.ts` L186–193）。

### 自我鎖定（[`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §8.4）

`apps/api/src/modules/permission/permission.service.ts` 的 `assertNoSelfLockout()`（L200–219）：

```ts
if (!(await this.repo.userHasRole(actorId, roleId))) return;
const remaining = permissionClosure([
  ...(await this.repo.findPermissionKeysByUserExcludingRole(actorId, roleId)),
  ...(nextRoleKeys as PermissionKey[]),
]);
```

`userHasRole()` 與 `findPermissionKeysByUserExcludingRole()`（`permission.repository.ts` L29–65）都只看直接持有。

- 漏擋：操作者只經由群組持有角色 R（R 帶 `role:read`、`role:update`、`role:grantPermission`）。他拿掉 R 的 `role:grantPermission` 會成功，自己被鎖在外面。
- 誤擋：操作者直接持有 R1，另外經由群組持有提供同樣權限的 R2。他改 R1 會得到 `ROLE_SELF_LOCKOUT`，但其實不會失去那些權限。

### 角色使用中

`role.service.ts` 的 `remove()`（L313–316）以 `RoleRepository.countUsers()` 判斷 `ROLE_IN_USE`。
`countUsers()`（`role.repository.ts` L316–326）的條件是 L67 的 `holdersOf`，只算直接持有者。
只由群組持有的角色，不帶 `force` 也刪得掉，群組的成員立即失去這些權限。

### 推播的受眾

- `RoleService` 有五處決定 `affectedUserIds`：`update`（L187）、`updatePermissions`（L251）、`remove`（L318）、`restore`（L381）、`revertToRevision`（L504）。
  - 用的是 `findUserIdsByRole()`（`permission.repository.ts` L86–92）或 `findHolderIds()`（`role.repository.ts` L260–266）。
  - 兩者都只有直接持有者。
- `rolePermission` 的 perm room 只有 `role:read`（`apps/api/src/modules/realtime/realtime.audience.ts` L49）。
- 所以經由群組持有角色、又沒有 `role:read` 的人，收不到推播。

前端也只認直接持有：`apps/backstage/src/apis/resources.ts` 的 `selfHoldsRole()`（L176–180）以 `profile.roles` 決定要不要重抓 profile。
`profile.roles` 來自 `listRoleSummaries()`，只有直接持有的角色。所以即使推給了群組的成員，前端也不會重抓。

`permissionsChanged(holders)` 的 `userIds` 也只有直接持有者。這份名單用來補建個人資料夾；漏掉的人由 `GET /file-folders` 當場補建。

## 影響

- 自我鎖定：行為與規格不一致。可能誤擋合法的修改，也可能讓管理者把自己鎖在外面（super-admin 仍可修復）。
- 使用中：只由群組持有的角色刪除時沒有確認，成員無預警失去權限。刪除是軟刪除，可以從回收桶還原。
- 推播：角色的權限被改、角色被刪除或還原、還原到某一版之後，只經由群組持有的人畫面不會更新，要等 profile 重抓（例：重新整理頁面）。
  - 權限被拿掉時按鈕還在，按了得到 403。
  - 權限被加上時，看不到新功能。
- 角色改名（L187）對這些人沒有可見的影響：他們的 profile 本來就不列經由群組持有的角色。
- 沒有提權風險：伺服器端的授權判斷與權限快取以整個租戶失效，不受影響。

## 修正方式

1. 新增 `PermissionService.findUserIdsHoldingRole(roleId)`：直接持有者，加上持有這個角色的群組（含巢狀）的成員。
   - 可以直接用 `AuthzService.usersInSubjectSets([{ type: 'role', id: roleId, relation: 'holder' }])`。公告的受眾已在用，會沿巢狀群組展開。
   - 也可以找出持有它的群組，再以 `GroupRepository.memberUserIds()` 逐一展開。
   - `RoleService` 的五處改用它；`remove` 要在軟刪除之前查。
2. 推播：只經由群組持有的人，另外送一筆 `userRole update`（`id` 是本人、帶 `refs.role`），前端以 `isSelf` 重抓 profile。
   角色還原（`role.service.ts` L383–397）已經是這個寫法，原因相同：前端無法從角色的變更判斷自己是不是持有者。
3. 自我鎖定：以操作者的主體閉包（`getPermissionSet(actorId).subjects` 裡的 `role:<id>#holder`）判斷他是否持有 R；剩下的權限取閉包中 R 以外的角色的鍵。
4. 使用中：擇一。
   - （建議）`countUsers()` 改算直接持有者加上群組成員（同第 1 點）。`userCount` 的語意就與「誰會失去權限」一致。
   - 另外以 `details.groupCount` 回報持有它的群組數，同樣回 `ROLE_IN_USE`。
5. 文件同步：
   - [`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §8.4、[`rbac/04-api-spec.md`](../rbac/04-api-spec.md) §3.4。
   - [`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §6.1 的「持有該角色的所有人」改成含經由群組，§7.3 的對照表一併更新。

## 驗證方式

- `apps/api/test/groups.spec.ts` 補：
  - 只經由群組持有 R 的管理者，拿掉 R 的 `role:grantPermission` → `403 ROLE_SELF_LOCKOUT`。
  - 直接持有 R1、經由群組持有同樣權限的 R2，改 R1 → 放行。
  - 只由群組持有的角色，不帶 `force` 刪除 → `409 ROLE_IN_USE`。
- `apps/api/test/realtime.spec.ts` 補：經由群組持有角色、沒有 `role:read` 的成員，在角色的權限改變後收到 `resource.changed`，其中有本人的 `userRole update`。

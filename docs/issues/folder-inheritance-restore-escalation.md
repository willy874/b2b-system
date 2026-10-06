# 恢復資料夾的繼承沒有反提權檢查，只能授予 viewer 的人能讓上層的 editor、manager 流進來

## 現況

`apps/api/src/modules/file/file-folder-grant.service.ts` 的 `setInheritance()`（L137–171）只要求操作者在這個資料夾有 `share`（L144）。
中斷繼承時會複製授權；恢復繼承時不做任何等級的檢查（L147）：

```ts
const copied = dto.inheritGrants ? [] : await this.copyInherited(ctx, folderId, actor, tx);
await this.folders.setInheritGrants(
  folderId,
  { inheritGrants: dto.inheritGrants, updatedBy: actor.id },
  tx,
);
```

- 恢復之後，上層鏈（到下一個中斷點為止）的授權立刻流到這個資料夾與它的子孫。
- 直接授權走 `set()`，會以 `assertGrantable()`（L292 起）比對 `missingActions()`；恢復繼承不經過它。

重現（`apps/api/test/file-access.spec.ts` 已有這個角色：`SHARER`，全域 `file:read` ＋ `file:share`，L40）：

1. 共用資料夾（everyone 是 editor，[`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md) §12）底下有資料夾 F，被管理者中斷繼承、設成私人。
2. SHARER 直接授權 `PUT /file-folders/F/grants { everyone, editor }` → `403 AUTHZ_ESCALATION`。他只能授予 viewer（L359 的案例）。
3. SHARER 改送 `PATCH /file-folders/F/access { inheritGrants: true }` → 200。
4. everyone（含他自己）在 F 變成 editor，能改名、刪除 F 裡任何人的檔案。

## 影響

- 違反 [`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md) §6.1：授予等級 L 時，L 蘊含的每個動作操作者在 F 都要有。也違反 [`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.1 的通則。
- 前提：操作者在 F 有 `share`，但沒有 `create`／`update`／`delete`。
  - 資料夾授權裡，`share` 只隨 manager 而來，而 manager 已經有全部動作。
  - 所以實際上是：自訂角色持有全域 `file:share`，沒有全域的更新與刪除權。
  - 預設角色只有 admin 有 `file:share`，而它有全部的 `file:*`，不受影響。
- 結果：
  - 私人資料夾被放寬到上層授權的對象，等級可以高於操作者給得起的。
  - 操作者自己在上層有授權時，也能藉此讓自己升級。

## 修正方式

`inheritGrants: true` 時，在樹鎖的交易內：

1. 算出恢復後會流進來的授權：`inheritanceChain(ctx.folders, folder.parentId)`（`file-grant.levels.ts` L71–82）上的授權。用 `grants.listOn()` 讀，去掉已過期的。
2. 以這些授權的等級呼叫 `assertGrantable(ctx, folderId, levels)`。

另一個做法更簡單、也更嚴格：恢復繼承時要求操作者在 F 擁有 manager 的全部動作（`ctx.missingActions(['manager'], folderId)` 是空的）。
擇一；建議第一種，只擋真的會放寬的情況。

文件同步：[`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md) §3.3 補一句「恢復繼承等於授予上層的等級，受 §6.1 限制」。

## 驗證方式

- `apps/api/test/file-access.spec.ts` 的中斷繼承案例（L488）之後補：
  - 管理者中斷繼承，並移除複製來的授權。
  - 上層有 contributor 以上的授權時，SHARER 恢復繼承 → `403 AUTHZ_ESCALATION`，`inheritGrants` 仍是 false。
  - 上層只有 viewer 時放行。
- `apps/api/src/modules/file/__tests__/file-folder-grant.service.spec.ts` 的 `setInheritance` 區塊（L540 起）補對應的單元測試。

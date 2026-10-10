# MFA 政策頁：「不符合政策的人數」逐人查詢，「查看使用者」的範圍與人數不一致

## 現況

**逐人查詢。** `apps/api/src/modules/mfa/mfa-policy.service.ts` 132–145 行的 `countNonCompliant()`：

```ts
const candidates = await this.factors.listActiveUserIdsWithoutMfa();
if (policy.requireAll) return candidates.length;
for (const userId of candidates) {
  if (await this.availability.isRequiredBy(policy, userId)) count += 1;
}
```

只要求特定角色時，對每個還沒設定 MFA 的人 **依序** 呼叫 `isRequiredBy()`（`mfa-availability.service.ts` 107–116 行）→
`UserAccountService.listEffectiveRoles()`（`apps/api/src/modules/user/user-account.service.ts` 195–203 行）：
每人一次 `permissionService.getPermissionSet()`（有快取，但冷快取時要解析整個主體閉包）加一次 `repo.findActiveRolesByIds()`（每次都打 DB）。
註解寫「權限解析有快取」，但後面那個查詢沒有快取。這段在 **`GET /mfa/policy`（每次開政策頁）** 與 **`POST /mfa/policy/preview`（每次儲存前）**
都會跑（同檔 49、57 行）。規格 [`backend/21-mfa.md`](../architecture/backend/21-mfa.md) 768 行定的是「逐人判斷」，沒有考慮人數。

**「查看使用者」的範圍。** `apps/backstage/src/features/security/pages/MfaPolicy/page.tsx` 147–161 行：人數大於 0 時顯示
`<RouteLink to="user.listByMfa" params={{ mfa: 'false' }}>`，只帶 `mfa=false`。

- 規格 21-mfa.md 384 行：可以點進使用者列表（`mfa=false` **＋ 角色篩選**）；frontend/20-mfa.md 63 行只寫 `?mfa=false`，兩份規格不一致，實作跟著前端規格。
- 人數只算 `active`、`human`、未刪除、而且（只要求特定角色時）持有指定角色的人（`tenant-mfa.repository.ts` 229–242 行）；
  連過去的列表是不分狀態、不分角色的全部 `mfa=false`。例：政策只要求 `admin`，頁面寫「2 人不符合」，點進去列出 300 人。
- 就算補上 `roleId`，使用者列表的角色篩選（`apps/api/src/modules/user/user.repository.ts` 208–216 行）只看 **直接持有**
  （`subject_type = user`），經由群組持有角色的人不會出現，仍與人數（含群組閉包）不一致。

## 影響

- 未設定 MFA 的人多（例如剛把政策從「關」改成「只要求 admin」的大租戶，幾千人沒設定）時，開政策頁與每次預覽都要依序發出數千個查詢，
  頁面載入以秒計，也會把所有人的權限集合擠進快取。
- 管理者點「查看使用者」看到的人數與名單對不上，無從找出真正需要處理的人。

嚴重度中：「查看使用者」與後端規格不一致、人數與名單對不上；逐人查詢是效能問題，不影響結果正確性。

## 修正方式

1. **一次算完**：要求特定角色時，以一個查詢求「持有任一指定角色（直接或經由群組，含巢狀）的人」——
   `relation_tuples` 的遞迴 CTE，或沿用權限解析的反查（「誰持有 `role:<id>#holder`」，角色詳情頁的群組持有者已有類似查詢）——
   再與 `listActiveUserIdsWithoutMfa()` 的條件做交集，在 DB 裡 `count(*)`。保留 `isRequiredBy()` 給單人的登入流程。
   同步更新 21-mfa.md 768 行的說法。
2. **名單與人數一致**：使用者列表加一個與人數同義的篩選，例如 `GET /users?mfaRequired=missing`（後端用第 1 步的同一個查詢，條件是目前的政策），
   `user.listByMfa` 的 route link 帶它；或讓 `roleId` 篩選可以選擇「含經由群組持有」，連結帶 `mfa=false&status=active&roleId=…&viaGroups=true`。
   兩份規格（21-mfa.md 384 行、frontend/20-mfa.md 63 行）改成同一個說法。

## 驗證方式

- api 整合測試：政策只要求角色 R；建立直接持有 R、經由巢狀群組持有 R、不持有 R、停用、`pending` 的使用者各一 → `nonCompliant` 為 2；
  以查詢計數（或 spy `findActiveRolesByIds`）確認查詢數不隨人數增加。
- 使用者列表以新的篩選查詢，回傳的 id 與上面兩位相同。
- 前端 `MfaPolicy` 頁面測試：「查看使用者」的連結帶新的篩選。

（2026-10-10 backstage 各功能的優化分析發現。）

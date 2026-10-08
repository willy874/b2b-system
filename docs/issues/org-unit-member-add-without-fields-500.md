# 部門加成員只帶 userId 時回 500

## 現況

- 前端的「加入」只送 `userId`：`apps/backstage/src/features/organization/pages/Organization/components/OrgUnitMemberSection.tsx:244`
  （`{ add: [{ userId }], update: [], remove: [] }`）。
- `OrgUnitRepository.upsertMembers`（`apps/api/src/modules/organization/org-unit.repository.ts:568-589`）對每一列做
  `insert … onConflictDoUpdate({ set })`，`set` 只放有帶的欄位；三個欄位都沒帶時 `set` 是 `{}`，
  Drizzle 在建構查詢時就丟 `Error: No values to set`（`drizzle-orm/src/utils.ts` 的 `mapUpdateSet`），不論這個人是不是已經是成員。
- 結果 `PATCH /org-units/:id/members` 回 `500`，畫面沒有錯誤提示，成員清單維持原樣。
- API 整合測試（`apps/api/test/organization.spec.ts` 的「成員」案例）每一列都帶了 `isManager`／`isPrimary`，所以沒有測到；
  唯一只帶 `userId` 的呼叫（`add: [{ userId: ids.admin }]`）在服務層就因為 `AUTHZ_SELF_MODIFY` 擋下，沒走到 repository。

## 影響

組織管理頁 **無法用畫面加任何成員**（每次都 500）；匯入成員（`orgUnitMember` 的匯入）若某列沒有主管、主要部門、職稱三欄也會失敗。

## 修正方式

`upsertMembers` 在 `set` 為空時改用 `onConflictDoNothing`（「已是成員時當作 `update`」而沒有要改的欄位＝不變），
或把 `set` 至少放一個不變的欄位（例：`unitId`）。API 整合測試補一個只帶 `userId` 的 `add`。

## 驗證方式

- `apps/api/test/organization.spec.ts` 新增「只帶 userId 加成員 → 200，預設不是主管、不是主要部門」。
- E2E `apps/e2e/tests/organization.spec.ts` 的「在部門頁以畫面加成員」目前標了 `test.fail()`；修好後它會變成「意外通過」而失敗，
  拿掉 `test.fail()` 即可。

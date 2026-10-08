# 上層已刪除的部門：顯示當成最上層，同名檢查仍以原上層計

## 現況

`apps/api/src/modules/organization/org-unit.transfer.ts` 的 `OrgTree` 建構時，上層已刪除的部門
（註解說不應該發生：有下層的部門不能刪）會被掛到最上層，路徑、匯出的「上層」欄與深度優先順序都把它當成最上層的部門。

但同名檢查都用部門原始的 `parent_id`：

- 匯入驗證：同檔 `validateUnitRows` 的 `siblingsOf`（約 740 行）以 `unit.parentId` 找同層。
- 套用：`org-unit.service.ts` 的 `assertNameAvailable` → `repo.findSiblingByName(parentId, …)`。
- 資料庫：`db/schema/org-units.ts` 的 `org_units_sibling_name_key` 以 `coalesce(parent_id, 0…0)` ＋ `lower(name)` 唯一。

三者彼此一致，只有 `OrgTree` 的顯示不同。

## 影響

只在「上層已刪除的部門」這種不應該存在的資料上出現：
例如一個上層已刪除、名為「北區」的部門，把另一個「北區」搬到（或建立在）最上層時，驗證、套用、資料庫都不會擋，
之後匯出與路徑會出現兩個最上層的「北區」，以路徑（`北區`）參照時變成 ambiguous。

嚴重度低：前提是資料已經不一致；不影響權限或資料正確性。

## 修正方式

擇一：

1. 找出這種資料怎麼產生（若真的不可能，在 repository 或 trigger 層保證，`OrgTree` 的退回只是防呆，這份文件可直接關閉）。
2. 若可能發生，讓「孤兒部門」在各處的語意一致：例如 `OrgTree` 不把它當最上層、改成匯出時標示上層缺失，
   或清理工作把它的 `parent_id` 改為 `null`（這樣唯一索引也會一起生效）。

## 驗證方式

- 單元：`org-unit.transfer.spec.ts` 加一個案例：上層不在樹裡的「北區」＋把另一個「北區」放到最上層，依修正後的語意斷言。
- 若改資料或約束：整合測試（`apps/api/test/organization.spec.ts`）證明這種資料不會再產生或會被擋下。

（2026-10-08 補單元測試時由 `org-unit.transfer.spec.ts` 的撰寫發現。）

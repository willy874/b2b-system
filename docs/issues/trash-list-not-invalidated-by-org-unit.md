# 回收桶的列表不隨部門的刪除與還原更新

## 現況

- 回收桶的列表由依賴圖跟著資源失效：`apps/backstage/src/apis/resources.ts:376-389` 的 `[Resource.TRASH].derivesFrom`
  列了使用者、角色、群組、公告、檔案、資料夾，**沒有 `Resource.ORG_UNIT`**。
- 部門的還原（`apps/backstage/src/features/organization/hooks/useOrgUnitMutations.ts:106-120`）以
  `invalidateResources([{ resource: Resource.ORG_UNIT, kind: 'create' }])` 宣告，註解寫「回收桶由依賴圖跟著失效」，但依賴圖沒有這條邊。
  刪除（同檔 `kind: 'delete'`）也一樣。
- 結果：在回收桶「部門」分頁按「還原」，API 回 200、出現成功提示，但那一列與它的還原按鈕 **可能** 留在畫面上，重新整理後才消失；
  再按一次會得到 `409 ORG_UNIT_NOT_DELETED`。2026-10-08 的 E2E 兩次執行中一次留著超過 10 秒、一次有更新（有其他原因觸發重抓時才會更新，
  所以不是每次都看得到）。

## 影響

使用者以為沒還原成功、重按得到錯誤；在部門頁刪除後切到回收桶（快取還在時）也看不到剛刪的部門。

## 修正方式

`[Resource.TRASH].derivesFrom` 加一列 `{ from: Resource.ORG_UNIT, kinds: ['create', 'delete'], id: 'none' }`，與群組同理。
之後新增可進回收桶的類型時，`trash.ts` 的登記與這張依賴圖要一起改（可考慮由 `trash.ts` 的登記產生這些邊，避免再漏）。

## 驗證方式

- `apis/resources` 的依賴圖測試（若有）補部門；或 `OrgUnitRestoreAction` 的元件測試斷言還原後回收桶的查詢被失效。
- E2E `apps/e2e/tests/organization.spec.ts` 的「刪掉下層後從回收桶還原」目前在還原後 `page.reload()` 才斷言列消失
  （現象不是每次都出現，不能用 `test.fail()` 標記）；修好後拿掉 `reload`，直接斷言按鈕消失。

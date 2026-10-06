# 伺服器沒有遵守推播合約的 100 筆上限，還原有上百位持有者的角色時，前端整則丟掉

## 現況

- 推播合約 `packages/realtime/src/resource.ts`：
  - `MAX_CHANGES_PER_EVENT = 100`（L91）。
  - `ResourceChangedSchema` 的 `changes`，以及每個 `refs` 陣列，都 `.max(100)`（L127–135）。
  - [`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §9（L580–583、L598）規定客戶端要驗證伺服器推來的事件，不合就略過。
- 前端 `packages/web-core/src/realtime/RealtimeClient.ts` 的 `onServerEvent()`（L156–168）驗證失敗就直接 `return`，沒有任何紀錄。
- 伺服器端沒有任何一處檢查這個上限：`RealtimeListener.onResourceChanged()`（`apps/api/src/modules/realtime/realtime.listener.ts` L84–102）原樣送出 `changes`。
  - 只有呼叫端自己注意的地方才不會超過：
    - 通知：`notification.service.ts` 的 `changesFor()`（L83–86）超過就改成不帶 id。
    - 回收桶：`TRASH_PURGE_BATCH_SIZE = 100`，`trash.constants.ts` L35–36 的註解寫明它也是推播的上限。
- `RoleService.restore()`（`modules/role/role.service.ts` L381–397）每位持有者產生一筆變更：

```ts
changes: [
  { resource: ChangeSource.ROLE, kind: ChangeKind.CREATE, id },
  ...holders.map((userId) => ({
    resource: ChangeSource.USER_ROLE, kind: ChangeKind.UPDATE, id: userId, refs: { [ChangeSource.ROLE]: [id] },
  })),
],
```

  `holders` 來自 `findUserIdsByRole()`（`modules/permission/permission.repository.ts` L86–92），沒有上限。
- 另一個可能超過的地方：`FileSystemFolderService.removeEmptyPersonalFolders()`（`modules/file/file-system-folder.service.ts` L119–127）。啟動時不帶 `ownerIds` 清理，一次可能刪掉 100 個以上的個人資料夾。
- 跨程序轉送也有同樣的洞：`core/events/event-relay.ts` 的 `split()`（L108–132）只在訊息放不進 8000 位元組時才降成粗粒度。放得進、但超過 100 筆的訊息，接收端的 `PAYLOAD_SCHEMAS`（L40–57）一樣會拒收。

重現：

1. 建立一個自訂角色，直接指派給 100 位以上的使用者。
2. 刪除這個角色，再從回收桶還原（`POST /roles/:id/restore`）。
3. 這一則 `resource.changed` 有 101 筆以上的變更。每個收到的分頁都驗證失敗、整則丟掉，角色列表、回收桶、持有者的 profile 都不會重抓。

## 影響

- 推播只是加速，不影響正確性（[`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §1 原則 1）。畫面要等 query 過期或重新整理才更新，這段時間持有者看到的權限是舊的。
- 前提：角色有 100 位以上的直接持有者。1000 人規模的租戶很容易遇到。
- 丟棄沒有任何紀錄，很難發現。之後新增的寫入點也可能踩到同一個洞。
- [`role-checks-ignore-group-holders.md`](./role-checks-ignore-group-holders.md) 的修正會替經由群組持有的人也各送一筆 `userRole update`，角色相關的推播會更容易超過上限。兩份要一起做。

## 修正方式

1. 在伺服器端統一處理：
   - `RealtimeListener.onResourceChanged()`（以及 `onPlatformChanged()`）在 `changes` 超過 100 筆，或任何 `refs` 陣列超過 100 時，改成去重後的 `{ resource, kind }`（不帶 `id`、`refs`）。
   - 這段邏輯和 `event-relay.ts` 的 `split()` 抽成同一個函式，例如由 `packages/realtime` 匯出 `coarsenChanges()`。轉送前也套用一次。
2. `RoleService.restore()` 在持有者超過 99 位時，改送一筆不帶 id 的 `userRole update`。
3. 回收桶的批次大小直接引用 `MAX_CHANGES_PER_EVENT`，不要只靠註解維持。

## 驗證方式

- `modules/realtime/__tests__/realtime.listener.spec.ts`：餵 150 筆變更，斷言送出的 payload 能通過 `ResourceChangedSchema.safeParse`。
- `core/events/__tests__/event-relay.spec.ts`：101 筆小變更、放得進 8000 位元組的訊息，轉送後接收端仍然收得到。
- `apps/api/test/realtime.spec.ts`：還原一個有 100 位以上持有者的角色，用 socket.io-client 斷言收到的 `resource.changed` 能通過 schema。

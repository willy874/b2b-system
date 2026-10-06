# 事件點 `user.activated` 每一位使用者都解析整個公告受眾

## 現況

`apps/api/src/modules/announcement/announcement-dispatch.service.ts`：

- `runEvent()`（L206–242）在交易內先以 `lockActive()` 鎖住公告列（L213，`SELECT … FOR UPDATE`），再呼叫 `matches()`（L221）。
- `matches()`（L245–259）在比對方式是 `audience` 時，解析整個受眾，再看這一個人在不在裡面：
  ```ts
  case 'audience':
    return (await this.audience.resolve(audience)).userIds.includes(data.userId);
  ```
- `apps/api/src/modules/announcement/announcement.audience.ts` 的 `resolve()`（L42–63）沒有帶 `tx`：
  - 平行查 3 條：有效的群組、有效的角色、指定的人。
  - 以遞迴 CTE 展開所有群組與角色的成員（`AuthzService.usersInSubjectSets()`）。
  - 再分段過濾全部成員（`announcement.repository.ts` L465 起的 `filterRecipients()`）。
- `user.activated` 的比對方式就是 `audience`（`apps/api/src/modules/user/user.announcement-triggers.ts` L8–10）。觸發點：
  - 建立時就是 active：`apps/api/src/modules/user/user.service.ts` 的 `createAccount()`（L581）。外部 IdP 首次登入自動建立帳號走這裡（`external-login.service.ts` L295–307）。
  - 完成啟用：`emitStatusChanged()`（L599）。
- 受眾是全租戶（`audience.all`）時直接回 true（L250）。只有指定群組、角色或人的公告會走到 `resolve()`。
- `announcement.eventDispatch` 用預設並行 1（`announcement.job-types.ts` L62–70），工作依序執行。

## 影響

- 前提：有一則以 `user.activated` 觸發、受眾是群組或角色的公告（典型用法是新人入門指南），而且一次有很多人啟用，例如上線日的 SSO 首次登入、批次建立帳號。
- N 人啟用、受眾 M 人時，總共處理 O(N × M) 列：1,000 人 × 1,000 人就是 100 萬列。剛建立、還不在任何群組的新帳號也照算一次。
- 每筆工作持有公告列的鎖，同時另外佔用最多 3 條連線查受眾。工作依序執行，入門公告會晚好幾分鐘才發出。
- 每筆工作（以及後續的 `announcement.fanOut`）另外再付一次同時執行數的排名查詢（已改成走索引，見 [`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §3）。

## 修正方式

1. 只判斷這一個人：
   - 以 `AuthzRepository.subjectClosures([userId])`（`apps/api/src/core/authz/authz.repository.ts` L46 起）取這個人的主體閉包。
   - 與受眾的 `group:<g>#member`、`role:<r>#holder` 取交集，或命中 `audience.userIds`。
   - 最後確認這個人可登入（未刪除、`active`、是人），與 `filterRecipients()` 同一個條件。
   - 查詢次數固定，與受眾大小無關；與正向解析同一張圖、同樣的條件（[`backend/19-announcement.md`](../architecture/backend/19-announcement.md) §4）。
2. 判斷移到 `lockActive()` 之前：先不上鎖讀公告做比對，命中了才進交易、鎖住、重新確認狀態後建立發送。交易內不再另外取連線。

## 驗證方式

- `apps/api/src/modules/announcement/__tests__/announcement-dispatch.service.spec.ts`：
  - `audience` 比對不再呼叫 `AnnouncementAudienceResolver.resolve()`。
  - 巢狀群組、群組持有的角色、已刪除的群組或角色、停用的人，各一個案例。
- `apps/api/test/announcements.spec.ts` 既有的事件點案例照常通過（加入受眾裡的群組只發一次、建立就是 active 的帳號）。

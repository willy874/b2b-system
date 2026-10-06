# 站內通知每位收件人一個推播事件，每個都依序經 `NOTIFY` 轉送

## 現況

`apps/api/src/modules/notification/notification.service.ts` 的 `publishChanges()`（L331–348）每位收件人發一則 `RESOURCE_CHANGED`：

```ts
for (const [recipientId, ids] of byRecipient) {
  this.events.publish(DomainEvent.RESOURCE_CHANGED, {
    changes: changesFor(ids, kind),
    affectedUserIds: [recipientId],
  });
}
```

- `notify()` 在交易提交後呼叫它（L132）。
- 公告的 `fanOut()`（`apps/api/src/modules/announcement/announcement-dispatch.service.ts` L261 起）每 500 人一個交易
  （`announcement.constants.ts` L9 的 `ANNOUNCEMENT_FAN_OUT_BATCH_SIZE`），每批就是 500 則事件。
- 撤回公告的 `removeBySource()`（L256–265）也一樣，每刪一批就每人一則。

每一則事件都經平台 DB 轉送：

- `apps/api/src/core/events/event-relay.ts` 的 `forward()`（L200–223）訂閱本機發佈的每一則 `RESOURCE_CHANGED`（`RELAYED_EVENTS`，L27–32），
  逐則 `await publish(part)`（L219–222）。
- 每則都是一次平台 DB 的 `NOTIFY` 往返（`apps/api/src/core/broadcast/broadcast.service.ts` 的 `publish()`，L95–104）。
- `apps/api/src/core/events/event-bus.ts`：同一個租戶的事件排在同一條佇列（`laneOf()`，L30–33），`dispatch()` 逐一 await handler（L121–124）。
  所以這條佇列每完成一次往返，才處理下一則事件。
- 目前只有內部 api 與對外 API 兩個程序。對外 API 沒有 `RealtimeModule`（`apps/api/src/external-api.module.ts` L43），
  收到轉送也不會推給任何人。內部 api 往對外 API 這個方向的轉送是純成本，兩邊的 `LISTEN` 連線還都要解析每一則。

## 影響

- 一則公告發給 N 人，就是 N 次依序的 `NOTIFY` 往返。
  `announcement.maxRecipients` 預設 10,000，可以調到 100,000（`apps/api/src/modules/announcement/announcement.settings.ts` L9–15）。
- 估算（未在正式環境量測）：區網往返 0.1–0.3 ms 時，10,000 人約 1–3 秒；託管 DB 往返約 1 ms 時約 10 秒。
- 這段期間，同一個租戶的其他推播都排在後面，例如權限變更後的 room 同步、別人編輯資料的 `resource.changed`。
  推播只是加速，資料不會錯，但畫面會晚幾秒到十幾秒才更新。
- 平台 DB 的連線池在這段期間一直有一條被佔著。
- 1000 人的租戶發全員公告約 1,000 次往返，影響不大；人數越多越明顯。

## 修正方式

1. 建議：一批通知只發一則事件，帶「收件人 → 通知 id」的對照。
   - 例如 `RESOURCE_CHANGED` 加一個可選的 `perRecipient`，`RealtimeListener.onResourceChanged()` 依對照逐人推給各自的 user room。
   - 通知 id 仍只推給收件人自己（[`backend/15-notification.md`](../architecture/backend/15-notification.md) §7）。
   - relay 照 8000 位元組的上限拆成少數幾則（[`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §7.6）。
2. relay 不要讓佇列等 `NOTIFY`：handler 把訊息交給有上限的送出佇列就返回，或把同一輪的多則合併成一則送出。
3. 對外 API 不 `LISTEN` `domain_event`：它沒有 remote 的訂閱者，少一份解析。

## 驗證方式

- `apps/api/src/modules/notification/__tests__/notification.service.spec.ts`：一批 500 人只發 1 則事件，payload 帶每個人的通知 id。
- `apps/api/test/realtime.spec.ts`：每位收件人仍只收到自己的通知 id，收不到別人的。
- `apps/api/src/core/events/__tests__/event-relay.spec.ts`：一則帶 500 人對照的事件，拆成的 `NOTIFY` 則數有上限。
- 量測：發 10,000 人的公告時，記錄同一個租戶另一則推播晚了多久。

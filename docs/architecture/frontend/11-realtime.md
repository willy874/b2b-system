# 前端 11 — 即時推播

> 狀態：**已實作**。決策理由見 [ADR-0008](../../adr/0008-realtime-with-socket-io.md)；
> 伺服器端（room、受眾、事件合約）見 [`../backend/08-realtime.md`](../backend/08-realtime.md)。

## 1. 它解決什麼

| 情境                                     | 之前                                  | 之後                                   |
| ---------------------------------------- | ------------------------------------- | -------------------------------------- |
| 別人（或自己在別台裝置）改了資料         | 等 `staleTime` 或 window focus        | 收到 `resource.changed`，立刻失效      |
| 自己的角色權限被改                       | profile 每 5 分鐘重抓                 | 同上，`PROFILE` 由依賴圖衍生失效       |
| 自己被停用 / 強制登出                    | 下一次操作才被 401 擋下               | 收到 `session.revoked`，立刻結束 session |
| 同一瀏覽器的其他分頁                     | `query-invalidate`（BroadcastChannel）| **只有 leader 分頁持有連線**，經 control channel 轉給其他分頁；BroadcastChannel 的 `query-invalidate` 只在推播不可用時接手 |

**推播只是加速**：斷線、被擋、事件遺失時，行為退回到之前那一欄，不會出錯。

多分頁的設計參考 [fortes1219/socket-meetup-frontend](https://github.com/fortes1219/socket-meetup-frontend)：
**BroadcastChannel 是 control plane，不是資料匯流排**。它只傳選舉、擁有權、失效訊號這類低頻協調訊息；
資料一律由各分頁自己經 HTTP 取得（§3.3、§3.4）。

---

## 2. 分層位置

```
main.tsx                                   注入 applyResourceChanges（plugins 不能 import apis）
plugins/app/realtime.ts                    ★ 組裝：連線物件 ＋ leader 選舉 ＋ control channel ＋ 協調者
plugins/fetcher/client-id.ts               ★ 每個請求帶 x-client-id
apis/resources.ts                          ＋ applyResourceChanges()：只在本分頁套用
core/realtime/
├── RealtimeClient.ts                      ★ 連線、續期、事件分派；`setOwner()` 決定連不連。只依賴 `RealtimeTransport`
├── transport.ts                           ★ `RealtimeTransport` 介面：RealtimeClient 對連線的所有要求
├── socketIoTransport.ts                   ★ `RealtimeTransport` 的 Socket.io 實作；全 app 唯一 import socket.io-client 的檔案
├── RealtimeCoordinator.ts                 ★ 只讓 leader 連線、轉發變更、序號與任期、背景延後、削峰（§3.3、§3.4）
├── activeClient.ts                        目前的連線與協調者（isRealtimeAvailable）：core/cache 不必認識 plugin
├── clientId.ts                            分頁的 instance id（也用在 x-client-id）
├── useRealtimeEvent.ts                    feature 訂閱伺服器事件的唯一入口
├── useRealtimeStatus.ts                   連線狀態（connected／disconnected／disabled）；頂列的連線燈號用
└── index.ts
core/cache/AppQueryClient.ts               推播可用時不再跨分頁廣播；applyInvalidation 支援只標 stale
shared/channel/leader/                     ★ 跨分頁 leader 選舉（純引擎，adapters 可注入）
shared/utils/keyedThrottle.ts              以 key 去重、隨機延遲削峰
shared/channel/transports/serverRelay.ts   ★ 跨裝置頻道的傳輸層（經 `ServerRelayLink`，不認識 Socket.io）
shared/websocket-sdk/                      `@b2b-system/realtime` 的唯一匯入點（同 shared/api-sdk）
```

依賴方向照 [`conventions/07`](../../conventions/07-layer-dependencies.md) §2：

- **只有 `core/realtime/socketIoTransport.ts` import `socket.io-client`**（🔒 `transport-boundary.test.ts`）。
  `RealtimeClient` 只認得 `RealtimeTransport`，對外也不交出連線本身：feature 用 `useRealtimeEvent()`，
  跨裝置頻道用 `realtime.relay`。換掉 Socket.io 時只要換掉這一個檔案（實作新的 `RealtimeTransport`）。

  | `RealtimeTransport` 的要求 | Socket.io 實作的對應 |
  | -------------------------- | -------------------- |
  | `hooks.authenticate()` 每次（重）連線都呼叫；回 `undefined` 放棄這次連線 | `auth` 設成函式；`undefined` 時 `socket.disconnect()` |
  | `onDisconnect({ byServer })`：伺服器斷的不自動重連 | `reason === 'io server disconnect'` |
  | `onConnectError({ code })`：有 `code` 是伺服器拒絕（不自動重試），沒有是網路錯誤（自動退避重連） | `err.data.code`（`RealtimeConnectErrorData`） |
  | `isActive`：連線中或等待重連 | `socket.active` |
- 測試注入假的 `RealtimeTransport`（`RealtimeClient` 的 `createTransport`、`realtimePlugin` 的 `createTransport`）；
  Socket.io 的設定（路徑、只用 websocket、`auth` 是函式）由 `socketIoTransport.test.ts` 單獨驗。
- `plugins/` 不能 import `apis/`，所以「收到來源變更 → 依賴圖換算」的函式由 `main.tsx` 注入。
- Feature 不直接碰 socket，一律透過 `useRealtimeEvent()`（§8）。
- 事件名稱都用常數，不寫字串：伺服器事件用合約的 `ServerEvent`，`RealtimeClient.events` 用 `RealtimeClientEvent`
  （`resourceChanged`、`connected`、`disconnected`）。伺服器事件要轉成 `events` 的，登記在 `SERVER_TO_CLIENT_EVENT`
  對照表（目前只有 `resource.changed` → `resourceChanged`）；兩邊 payload 不一致時編譯失敗。

---

## 3. 連線生命週期

```ts
// main.tsx
.use(realtimePlugin({ backend: MAIN_BACKEND, onResourceChanged: applyResourceChanges }))
```

| 時機                                | 動作                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- |
| plugin 建立（同步階段）             | 建立 `RealtimeClient`（只建傳輸層、不連線）、leader 選舉、control channel、`RealtimeCoordinator`：`attrs.realtime` 與 §7 的 `realtime.relay` 在啟動時就要拿得到 |
| plugin `onInit`                     | 協調者先交出擁有權，再開始選舉；**當選 leader 且有 session** 才連線（§3.3） |
| `SessionStore` 從無到有（登入）     | leader 分頁連線                                                      |
| 失去 / 取得 leader                  | 斷線 / 連線（`client.setOwner()`）                                   |
| `pagehide` / `pageshow`（bfcache）  | 讓位（其他分頁不必等心跳逾時）/ 回來時重新參與選舉                   |
| `SessionStore` 發出 `refreshed`     | 送 `session.renew` 帶新 token                                        |
| 收到 `session.expired`（閒置分頁）  | 重新連線；handshake 會先續期 token                                   |
| `SessionStore` 發出 `ended`（登出） | 斷線                                                                 |
| 收到 `session.revoked`              | `session.endSession(reason)`，之後照一般登出流程                     |
| plugin `onDestroy`                  | 斷線並移除所有監聽                                                   |

### 3.1 handshake 的 token：`auth` 寫成函式

```ts
const socket = io({
  path: '/api/socket.io',
  transports: ['websocket'],
  autoConnect: false,
  auth: (cb) => {
    // 每次（重）連線都會重新取值：拿到的是續期後的 token，閒置過期的也會先續期
    void session.ensureAccessToken().then((token) => cb({ token }));
  },
});
```

- **不能寫成物件**（`auth: { token }`）：那是建立當下的值，5 分鐘後的重連會帶過期 token。
- `ensureAccessToken()` 會經過 Web Locks 單飛（[09 §5.1](./09-state-and-storage.md)），
  多個分頁同時重連不會各自輪替 refresh token。
- `ensureAccessToken()` 回 `undefined`（已登出）或失敗（網路）時不送 handshake；等下一次 `refreshed` 或登入再連。
- `session.renew` 的 ack 是 `{ ok: false }` 時：斷線後重新 handshake，錯誤碼交給 §3.2 統一處理。

### 3.2 `connect_error`

| `err.data.code`          | 處理                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| `AUTH_TOKEN_INVALID`     | 呼叫 `session.renewAccessToken(rejected)` 後重試一次；再失敗就停止重連 |
| `AUTH_TOKEN_STALE`       | 結束 session（與 HTTP 收到同一碼的處理相同）                     |
| `AUTH_ACCOUNT_DISABLED`  | 同上                                                             |
| 沒有 `code`（網路、proxy）| 交給 Socket.io 的指數退避重連                                   |
| 表格以外的 `code`        | 不自動重連、不結束 session；開發環境記一行 warning               |

Origin 或速率限制是在 HTTP 升級階段被拒，`connect_error` 不帶 `code`（[後端 08 §11](../backend/08-realtime.md)）。

推播連不上 **不顯示錯誤給使用者**；功能退回定期重抓。開發環境在 console 記一行 warning。

---

### 3.3 連線擁有權：只有 leader 分頁連線

每個分頁都連 Socket.io，成本不只是多幾條連線：每則推播在每個分頁都要解析、驗證、換算依賴圖、失效、重抓。
所以同源的所有分頁 **共用一條連線**，由選出來的 leader 分頁持有（`shared/channel/leader` 的 `createLeaderElection`）：

| 規則 | 說明 |
| ---- | ---- |
| **可見的分頁才競選** | 分頁載入或變為可見時送 `request-leader`，等 200–400 ms（固定 ＋ 隨機）沒人回應就當選 |
| **最新變為可見的分頁當 leader** | 現任 leader 收到 `request-leader` 就讓位（`leader-release`，`reason: 'yield'`）；使用者正在看的分頁持有連線 |
| **進背景不讓位** | 只有一個分頁、使用者切到別的應用程式時，連線不會無故中斷；要等另一個可見分頁來要 |
| **兩個視窗並排不互搶** | 可見時被要走 → `isSuspended`，暫停競選，直到本分頁再次變為可見 |
| **leader 消失就接手** | leader 每秒心跳；3 秒沒收到，或收到 `reason: 'shutdown'` 的讓位（分頁關閉），可見分頁重新競選 —— **並解除 suspended** |
| **任期單調遞增** | `LeaderTerm = { counter, ownerId }`，counter 存在 localStorage（`b2b-system:leader:realtime:<後端>:counter`）；同時當選時較新的任期勝出，較舊的安靜退位 |

與參考實作的差異：

- 參考實作被動讓位後要使用者按「恢復」才重新競選；這裡在 leader **關閉或逾時** 時自動解除暫停，
  否則並排的另一個視窗在 leader 關掉後會一直沒有推播，直到使用者點它。
- 選舉訊息走 `createChannel()`（[09 §5](./09-state-and-storage.md)），不直接 `new BroadcastChannel()`：
  沿用略過自己、去重、未知 `type` 略過的語意，測試也能換成假的傳輸層。
- 引擎的狀態是 signal store（`election.state`），不綁框架。

### 3.4 Control plane：leader 轉發給其他分頁

`realtime-control:<後端>` 頻道（`RealtimeCoordinator`）只傳低頻的協調訊號：

| 訊息 | 誰送 | 收到的分頁 |
| ---- | ---- | ---------- |
| `resource-changed { term, sequence, changes, origin? }` | leader，每收到一則伺服器推播 | 依 §4 套用 |
| `resync { term }` | leader 重新連上、或交接後第一次連上 | 整批重新驗證（§5） |
| `status { term, connected }` | leader 連上／斷線時；回應 `status-request` | 記下 leader 的連線狀態，決定推播是否可用（§4.2） |
| `status-request` | 新分頁加入時 | leader 回覆 `status` |

- **轉發的是來源變更，不是資料**：每個分頁用自己的依賴圖換算、自己重抓，不會因為 leader 轉手而變成二手資料。
- `sequence` 在同一任期內從 1 遞增：**重複的丟掉；跳號代表漏收**，不知道漏了什麼 → 整批重新驗證。
- 舊任期的訊息丟掉；收到較新的任期就從序號 0 重新計算。
- 其他分頁送來的 payload 無法信任型別：逐筆以 `ResourceChangeWireSchema` 驗證，有一筆不合就整批重新驗證。
- 伺服器的其他事件 **不轉發**（見 §8）。

## 4. `resource.changed` → 失效

伺服器推的是 **來源變更**，和 mutation 成功時宣告的一模一樣，所以沿用同一張依賴圖：

```ts
// apis/resources.ts
/** 伺服器推來的變更：只在本分頁套用。每個分頁都有自己的連線，不需要再轉給其他分頁。 */
export function applyResourceChanges(changes: readonly ResourceChangeEvent[]): void {
  queryClient.applyInvalidation(graph.resolve(changes));
}
```

套用的時機依分頁狀態而定（`RealtimeCoordinator.scheduleApply`）：

| 分頁 | 動作 | 為什麼 |
| ---- | ---- | ------ |
| 背景 | 立刻 `applyResourceChanges(changes, { refetch: false })`：只標 stale | 看不見的分頁不打 API；回到前景時 TanStack 的 `refetchOnWindowFocus` 重抓 stale 的 query |
| 可見 | 累積起來，150–750 ms 隨機延遲後一次套用並重抓 | 合併同一批寫入；同一筆寫入推給所有線上使用者時，把大家的重抓攤開（削峰） |

- `origin` 是本分頁（`x-client-id`）的不套用：mutation 成功時已經失效過。leader 發起的也照樣轉發給其他分頁。
- 看不懂的推播（schema 不合）在 `RealtimeClient` 就略過。
- 延遲與去重用 `shared/utils` 的 `createKeyedThrottle`（參考實作的 socket-event-throttle）。

- `isSelf`、`selfHoldsRole` 這類以登入者為視角的衍生，照樣在客戶端算——這正是伺服器不推 query key 的原因。
- 伺服器推來的 `resource` 只會是 `ChangeSource` 裡的值；前端 `Resource` 是它的超集，
  以型別層的斷言（`AssertServerSources<ChangeSource>`）在編譯期檢查兩邊一致。

### 4.1 回音去重：`x-client-id`

`plugins/fetcher/client-id.ts` 在每個請求加上 `x-client-id: <CLIENT_ID>`；伺服器把它放進推播的 `origin`。

| 分頁                             | mutation 成功時               | 收到伺服器推播             |
| -------------------------------- | ----------------------------- | -------------------------- |
| 發起的分頁                       | 本地失效                      | `origin` 是自己 → 略過（leader 仍會轉發） |
| 同瀏覽器的其他分頁（推播可用）   | —                             | 經 leader 轉發後失效       |
| 同瀏覽器的其他分頁（推播不可用） | 經 BroadcastChannel 失效      | —                          |
| 其他裝置、其他使用者             | —                             | 失效                       |

### 4.2 跨分頁廣播的降級

推播可用時，同瀏覽器的其他分頁會經 leader 收到同一筆變更；`broadcastInvalidation` 再廣播一次會讓它們失效兩次。

```ts
// core/cache/AppQueryClient.ts
broadcastInvalidation(targets: readonly InvalidationTarget[]): void {
  this.applyInvalidation(targets);
  // 推播可用時由 leader 轉給其他分頁；不可用（或推播停用）時才走本機頻道
  if (!this.isRealtimeAvailable()) this.channel.post('invalidate', targets);
}
```

「推播可用」＝本分頁是 leader 且連線中，**或** 已知的 leader 回報連線中（`status`）且心跳未逾時。
leader 當掉時 follower 在心跳逾時後改判為不可用，mutation 自動退回經本機頻道廣播。

兩個分頁連線狀態不同的短暫空窗裡，最壞情況是多失效一次，不會少失效。

---

## 5. 重連後的補償

斷線期間的推播會遺失（伺服器不保存）。以下情況 leader 廣播 `resync`，**所有分頁** 整批重新驗證
（可見分頁重抓 active 的 query；背景分頁只標 stale）：

| 情況 | 判斷 |
| ---- | ---- |
| leader 重新連上 | `RealtimeClient` 的 `RealtimeClientEvent.CONNECTED` 事件帶 `resumed: true`（這個分頁之前連線過） |
| leader 交接後第一次連上 | 當選前已知有別的 leader：交接的空窗（讓位 → 新 leader 連上）裡可能漏了推播 |
| follower 發現序號跳號 | 只有這個 follower 重新驗證（§3.4） |

唯一的分頁第一次連上時不重新驗證：頁面剛載入，資料本來就是新的。

不用 Socket.io 的 connection state recovery：它搭配 adapter 時限制很多，而這裡的資料量讓「全部重新驗證」足夠便宜。

---

## 6. `session.revoked` 與 `session.expired`

只有 leader 分頁收到這兩個事件：`endSession` 本來就會經 `session:<後端>` 頻道通知其他分頁登出；
`session.expired` 只影響 leader 自己的連線。

| 事件              | 意義                                          | 前端                                                       |
| ----------------- | --------------------------------------------- | ---------------------------------------------------------- |
| `session.revoked` | `token_version` 被遞增（停用、刪除、改密碼）  | `session.endSession(reason)` → 廣播 `session-ended` → 回登入頁 |
| `session.expired` | 連線上的 token 到期而沒有續期（閒置分頁）     | 不是登出：重新連線，handshake 會先續期                     |

`endSession` 是 latched 的：同一使用者在其他裝置的 leader 也收到時，各自的瀏覽器只觸發一次登出流程。

---

## 7. 跨裝置頻道：`serverRelayTransport`

`shared/channel` 的頻道可以經由伺服器中繼到同一個使用者的其他裝置：

```ts
createChannel('store:preference:theme', {
  transport: combineTransports(broadcastChannelTransport(), serverRelayTransport(realtime.relay)),
});
```

| 規則                                         | 說明                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| 送出走 `channel.relay`，只在 `relay.isConnected()` 時送 | 斷線時丟棄，不讓傳輸層（Socket.io）緩衝後補送（過期的狀態不該在重連時覆蓋別人的） |
| 伺服器只轉 **白名單** 頻道（`ge:store:preference:*`） | 其他頻道即使用了這個傳輸層也不會離開本機                              |
| `session:*` 頻道 **永遠** 只走 BroadcastChannel | 帶 token（[09 §5](./09-state-and-storage.md) 的安全限制）                   |
| 本機也檢查白名單                              | 不在 `RELAYABLE_CHANNEL_PREFIXES` 的頻道，`serverRelayTransport` 回 `undefined`（不經這條連線），不依賴伺服器擋 |
| 收訊方要自己持久化                           | 各裝置的 localStorage 不共用（[09 §5](./09-state-and-storage.md)「Store 的同步」）。偏好設定目前的 `store:preference:storage` 由 dictStorage 持有、收訊時不寫入，**只適用本機分頁**；要跨裝置時改用 `syncStore` |

`RealtimeClient` 在 plugin 初始化時就建立傳輸層（只是還沒連線），所以頻道可以在啟動時就綁上 `realtime.relay`。
`shared/channel` 只認得 `ServerRelayLink`（`isConnected` / `send` / `subscribe`），不認得 `RealtimeClient` 或 Socket.io。
**只有 leader 分頁會連線**：follower 經這個傳輸層送出的訊息會被丟棄（斷線時丟棄的規則）。
要讓 follower 也能跨裝置送出，得由 leader 代轉——接上偏好設定同步時一併設計。

> 既有的 `webSocketTransport(socket)` 是給原生 WebSocket 用的，與 Socket.io 的協定不相容；
> 連本專案後端時一律用 `serverRelayTransport(realtime.relay)`。

**首版範圍**：只接 §4 的失效與 §6 的 session 事件。偏好設定的跨裝置同步是第二步，接上時更新 [09 §5](./09-state-and-storage.md)「目前的頻道」表。

---

## 8. Feature 如何訂閱伺服器事件

```ts
// features/<name>/hooks/useSomething.ts
useRealtimeEvent(ServerEvent.SOMETHING, (payload) => { … });
```

- 事件名稱與 payload 型別來自 `@/shared/websocket-sdk`，不在 feature 裡寫字串。
- 一般的資料更新 **不需要** 訂閱：宣告在依賴圖裡就會自動失效（[05 §6.2](./05-data-layer.md)）。
  只有「不是 query 的東西」（例：之後的協作游標、長任務進度）才用 `useRealtimeEvent`。
- Feature 之間要互通仍走 eventBus；伺服器事件不是 feature 間的通訊管道。
- **只有 leader 分頁收得到**（follower 沒有連線）。所有分頁都需要的低頻事件，要在 `RealtimeCoordinator`
  加一種 control 訊息轉發（像 `resource-changed`）；高頻事件不轉發——BroadcastChannel 不是資料匯流排，
  需要的分頁應該自己成為 leader（使用者正在看的分頁本來就是）。

### 8.1 連線狀態

`useRealtimeStatus()` 回傳 `connected`／`disconnected`／`disabled`（沒有註冊推播，例如 mock 模式），
底層是 `isRealtimeAvailable()` ＋ `subscribeRealtimeAvailability()`：follower 分頁看的是 leader 回報的狀態，
所有分頁顯示一致。頂列的連線燈號（`app/layouts/RealtimeStatusIndicator.tsx`，頂列工具 `realtimeStatus`，
[02 §4.4](./02-plugin-system.md)）只顯示、不能操作。

隱藏的分頁不參與選舉：只開著一個背景分頁時沒有 leader，燈號會是 `disconnected`，這是預期行為。

---

## 9. Mock 與測試

| 層           | 作法                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------- |
| Mock 模式    | `ENV.ENABLE_MOCK` 時 **不註冊** `realtimePlugin`（MSW 不處理 Socket.io）；行為等同推播停用     |
| 單元         | `RealtimeClient` 注入假的 `RealtimeTransport`：schema 不合時略過、`connected` 的 `resumed`、`setOwner` 決定連不連、`refreshed` → `session.renew` |
| 單元         | `createLeaderElection`：假計時器 ＋ `src/test/fakeChannelHub.ts`（可控延遲、可模擬分頁當掉）；切換分頁、並排、當掉接手、同時當選、localStorage 不可用 |
| 單元         | `RealtimeCoordinator`：只有 leader 持有連線、轉發與 `origin`、背景只標 stale、合併、跳號與重複、舊任期、重連與交接的 `resync`、推播是否可用 |
| 單元         | `AppQueryClient`：兩個分頁以 `fakeChannelHub` 相連；推播可用時不廣播、不可用時廣播、收到的不再轉送；`refetch: false` 只標 stale |
| 單元         | `socketIoRealtimeTransport`：路徑、只用 websocket、`auth` 是函式、斷線原因與錯誤碼的對應      |
| 單元         | `serverRelayTransport`：斷線時丟棄、只交出外框給 `createChannel`                              |
| 結構         | `transport-boundary.test.ts`：只有 `socketIoTransport.ts` import `socket.io-client`           |
| E2E          | Playwright 開兩個 browser context：A 改角色權限，B 的選單在數秒內改變；A 停用 B，B 立刻回登入頁 |

---

## 10. 常見錯誤

| 錯誤                                                   | 後果                                           |
| ------------------------------------------------------ | ---------------------------------------------- |
| `auth: { token }` 寫成物件                             | 5 分鐘後的重連都帶過期 token，推播靜默停止     |
| 收到 `resource.changed` 後呼叫 `invalidateResources()` | 又經 BroadcastChannel 廣播，其他分頁失效兩次    |
| 在 feature 裡 `import { io } from 'socket.io-client'`  | 多開一條連線、沒有驗證與續期（🔒 測試會擋）     |
| 把 `session:*` 頻道接到 `serverRelayTransport`          | token 送出本機（伺服器白名單會擋，但不該依賴它）|
| 用推播取代 `staleTime`                                  | 斷線時資料永遠不更新；推播只是加速             |
| 經 control channel 轉發高頻事件或資料本體               | 每個分頁都付解析與渲染成本，正是 leader 模式要避免的 |
| 在 follower 分頁直接 `realtime.connect()`               | 繞過選舉，同一個瀏覽器又變成多條連線（連線擁有權由 `RealtimeCoordinator` 經 `setOwner()` 決定） |

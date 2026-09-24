# ADR-0008 — 以 Socket.io 做伺服器推播

- 狀態：**提案中（待確認）**
- 日期：2026-09-24
- 相關：[`../architecture/backend/08-realtime.md`](../architecture/backend/08-realtime.md)、[`../architecture/frontend/11-realtime.md`](../architecture/frontend/11-realtime.md)、[ADR-0004](./0004-jwt-with-rotating-refresh-token.md)、[ADR-0005](./0005-permission-resolved-server-side.md)

## 背景

目前所有「資料變了」的通知都只在 **同一個瀏覽器** 內流動：

| 情境                                      | 現況                                                      | 最壞延遲                  |
| ----------------------------------------- | --------------------------------------------------------- | ------------------------- |
| 同一瀏覽器的另一個分頁                    | `query-invalidate` 頻道（BroadcastChannel）               | 即時                      |
| 另一台裝置、另一個使用者                  | 等 TanStack Query 的 `staleTime` 或 window focus          | 數分鐘                    |
| B 的角色被改，B 的畫面上的按鈕與選單      | `GET /auth/profile` 定期重抓（`01-system.md` §3.3）       | ≤ 5 min                   |
| B 被停用 / 強制登出                       | 下一次 HTTP 請求才被 `AUTH_TOKEN_STALE` 擋下              | 直到 B 再操作             |

後端授權判斷已經是即時的（權限快取主動失效），缺的是 **把「變了」推到瀏覽器**。
之後的遊戲編輯器功能（協作編輯、資源鎖定、長任務進度）也都需要伺服器主動推送。

## 決定

- 採用 **Socket.io v4**：後端 `@nestjs/websockets` ＋ `@nestjs/platform-socket.io`，前端 `socket.io-client`。
- 路徑 `/api/socket.io`，**只用 `websocket` 傳輸**（關閉 long-polling）。
- 驗證走 **handshake 的 `auth.token`**（access token），不走 cookie；token 到期前以事件續期。
- 伺服器推的是 **來源變更**（`ResourceChangeEvent[]`），前端沿用既有的資源依賴圖換算要失效的 query。
- 受眾以 room 控制：`user:{id}`（本人所有連線）與 `perm:{permissionKey}`（持有該權限的人）。
- 業務 service 不直接呼叫 Socket.io：交易提交後發佈 **領域事件**（`core/events` 的 `DomainEventBus`），
  由 `modules/realtime` 訂閱後推播。推播與快取失效一樣 **在交易之後**。
- WebSocket 的訊息處理器與 HTTP 路由一樣 **預設拒絕**：沒宣告授權就啟動失敗。
- 事件合約放在新的 `packages/realtime`（zod schema ＋ 型別），前後端共用。
- 多執行個體時用 `@socket.io/postgres-adapter`，不引入 Redis。

## 理由

1. **Room 與廣播是這個需求的核心，而 Socket.io 內建。**「推給持有 `role:read` 的所有人」
   「推給這個使用者的所有裝置」就是 `io.to([...rooms]).emit()`，多 room 的聯集自動去重。
   原生 `ws` 要自己維護 `Map<room, Set<socket>>` 以及跨節點的同步。
2. **跨執行個體的擴展有現成 adapter，而且可以用既有的 Postgres。**
   `@socket.io/postgres-adapter` 走 `LISTEN/NOTIFY`，正好是 [`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §5.2
   為權限快取預留的升級路徑，兩者可以共用同一套基礎設施。
3. **自動重連、心跳、ack 不必自己寫。** 斷線偵測（`pingInterval` / `pingTimeout`）與指數退避重連
   都是容易寫錯、又和業務無關的部分。
4. **NestJS 有一級支援。** `@WebSocketGateway`、`@SubscribeMessage` 讓事件處理器可以掛 decorator，
   沿用「宣告式授權 ＋ 啟動時稽核」的既有模式。
5. **前端的傳輸層抽象已經就緒。** `shared/channel` 的傳輸層可替換，只要多寫一個
   `socketIoTransport()`；`createChannel` 的語意（略過自己、去重、未知 type 略過）不變。
6. **推來源變更、不推失效目標。** 伺服器不需要知道前端有哪些 query key；
   `PROFILE` 這類「以登入者為視角」的衍生（`isSelf`、`selfHoldsRole`）只有客戶端算得出來。
7. **以領域事件解耦發佈端與推播。** 業務模組只宣告「發生了什麼」，不 import realtime；
   受眾的判斷集中在 listener。之後的訂閱者（通知信、webhook）或換成 transactional outbox 都不用改發佈端。
8. **只用 websocket 傳輸。** 免去 long-polling 對 sticky session 的依賴（多執行個體時 LB 不必做親和性），
   也少了一條要處理 CSRF 的 HTTP 路徑。這是內部後台，使用環境可控。

## 代價

| 代價                                                                     | 緩解                                                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| **Socket.io 是自有協定**，不是標準 WebSocket；客戶端必須用 `socket.io-client` | 只在 `core/realtime` 與 `shared/channel/transports/socketIo.ts` 兩處接觸；換掉時影響範圍固定 |
| 前端 bundle 增加約 15 KB（gzip）                                         | 可接受；登入後才連線，可與 App Shell 一起分包                                                  |
| **`JwtAuthGuard` 對非 HTTP 直接放行**，路由稽核也看不到 `@SubscribeMessage` | 連線 middleware 驗證 token；路由稽核延伸到 gateway（[`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §5） |
| 長連線會比 5 分鐘的 access token 活得久                                  | 伺服器在 `exp` 到期時斷線；客戶端在 token 續期時送 `session.renew`                             |
| 開著的分頁會持續續期 token，session 不會因閒置而結束                     | 與「開著就是在用」的後台使用情境一致；需要閒置登出時放在 `SessionStore`，不靠連線              |
| 推播不保證送達（斷線期間的事件會遺失）                                   | 重連後整批重新驗證 active query；推播只是加速，正確性仍由 HTTP 與 `staleTime` 保證              |
| 同源的分頁要協調誰持有連線                                               | Leader 選舉（心跳 ＋ 任期）與 control channel，參考 fortes1219/socket-meetup-frontend；每個瀏覽器只有一條連線（[`frontend/11-realtime.md`](../architecture/frontend/11-realtime.md) §3.3） |
| leader 當掉到有人接手之間（最多約 3 秒）沒有推播                          | 新 leader 連上後廣播 `resync`，所有分頁整批重新驗證；推播只是加速                              |
| 關閉 long-polling 後，擋 WebSocket 的網路環境無法使用推播                | 推播失效時功能退化成現況（定期重抓），不會壞掉                                                 |

## 替代方案

| 方案                                  | 不採用的理由                                                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原生 `ws` ＋ 自訂協定                 | 前端已有 `webSocketTransport`，協定最輕。但 room、跨節點廣播、心跳、重連都要自己寫；之後協作編輯需要的 ack 也要自己做                                  |
| Server-Sent Events                    | 單向即可滿足失效通知，而且是純 HTTP。但 `EventSource` 無法帶 `Authorization` header（只能用 cookie 或 query string，前者要改 cookie Path，後者 token 會進日誌）；之後的雙向需求（協作、鎖定）還是要另外一套 |
| 輪詢（縮短 `staleTime` / profile 間隔） | 零新基礎設施，但延遲與請求量成反比，而且無法即時強制登出                                                                                             |
| 託管服務（Pusher、Ably 等）           | 多一個外部依賴與資料出境；授權要再做一次 token 交換                                                                                                  |
| Redis adapter                         | 功能相同，但要多維運一個 Redis；Postgres 已經在，量級也遠不到瓶頸                                                                                    |
| 每個分頁各自一條連線                  | 最簡單，但同一則推播在每個分頁都要解析、換算、重抓；開十個分頁就是十倍的伺服器連線與請求 |
| 用 SharedWorker 持有唯一的連線        | 連線數同樣最少。但 access token 只在分頁記憶體（ADR-0004），要傳進 worker；Android Chrome 沒有 SharedWorker |
| Web Locks（`navigator.locks` 的 `steal`）選 leader | 分頁關閉時鎖自動釋放、不必心跳。但被搶走的一方只能從 promise reject 得知，可見性驅動的讓位與「並排不互搶」要另外做；心跳版本的每一步都能以假計時器決定性地測試 |
| Service 直接注入 `RealtimePublisher`  | 最少一層間接，但每個業務模組都要依賴 realtime；拿掉或替換推播要改遍所有 service |
| `@nestjs/event-emitter`               | 功能足夠，但事件名稱與 payload 沒有型別對照、handler 預設並行，無法保證「room 先同步再推播」的順序 |
| 伺服器直接推失效的 query key          | 客戶端最省事，但伺服器要認得前端的 query 結構，且算不出以登入者為視角的衍生                                                                           |

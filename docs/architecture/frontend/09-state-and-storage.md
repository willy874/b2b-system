# 前端 09 — 狀態與儲存

## 1. 狀態的四個去處

| 類型           | 去處                        | 生命週期     | 例                             |
| -------------- | --------------------------- | ------------ | ------------------------------ |
| 伺服器狀態     | TanStack Query              | 快取管理     | 使用者列表、角色詳情           |
| 網址狀態       | Router `validateSearch`     | 跟著網址     | 分頁、篩選、排序               |
| 全域客戶端狀態 | `@b2b-system/web-shared/store` signal store | 整個 session | 權限集合、語系、時區、選單開合 |
| 區域狀態       | `useState` / `useReducer`   | 元件         | 對話框內的表單草稿、hover      |

**選擇順序**：能放網址就放網址 → 能放 Query 就放 Query → 需要同步讀取且跨元件
才放 store → 其餘 `useState`。

> 最常見的錯誤是把伺服器資料複製到 store 裡。那會製造兩份真相。唯一的例外是
> 權限集合（見 §3）。

---

## 2. Signal store

`@b2b-system/web-shared/store` 以 [`@sigrea/core`](https://github.com/sigrea/core) 的 signal 為底，分成兩層：

| 入口 | 內容 | 依賴 |
| --- | --- | --- |
| `@b2b-system/web-shared/store` | `createStore`、`watch`、`computed`、`untracked`、`syncStore`、`shareStore` | 只有 `@sigrea/core`，**不依賴 React** |
| `@b2b-system/web-shared/hooks`（`packages/web-shared/src/hooks/store.ts`） | `create`（Zustand 相容的 bound hook）、`useStore`、`useValue`、`useComputed` | React |

`@sigrea/core` 只在 `packages/web-shared/src/store/` 裡 import；`store/` 與 `context/` 不 import React。兩者都由 oxlint 的 `no-restricted-imports` 強制。

### 2.0 底層：依賴追蹤的 store

```ts
const layout = createStore<Layout>((set) => ({
  sidebarCollapsed: false,
  density: 'normal',
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));

layout.getState();                 // 快照，不追蹤（action、事件處理用）
layout.state.sidebarCollapsed;     // 追蹤：在 computed / watch 裡只依賴這個欄位
const label = layout.select((s) => (s.sidebarCollapsed ? 'collapsed' : 'open'));
const stop = watch(() => layout.state.density + permission.state.hydrated, (next, prev) => { … });
```

- 整份狀態是 **一個** signal，`setState` 一次寫入：多欄位同時改只通知一次，訂閱者看不到中間狀態。
- 每個欄位各有一個 `computed` 從快照取值：讀 `state.x` 只依賴 `x`，其他欄位變動時不會重算。
- `setState` 以 `Object.is` 比對，沒有欄位改變就不通知；`setState(partial, true)` 取代整份狀態。
- `subscribe` 與 `watch` 都是 **同步** 通知（`flush: 'sync'`），巢狀 `setState` 時舊值仍是上一次通知的值。

### 2.0.1 React 層

介面刻意與 Zustand 相容：

```ts
export const useLayoutStore = create<LayoutStore>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));

// 讀取時一律用 selector，避免無關欄位變動造成重渲染
const collapsed = useLayoutStore((s) => s.sidebarCollapsed);

// 跨 store 的衍生值：依賴自動追蹤；閉包用到的 props 列進 deps（同 useMemo）
const canEdit = useComputed(
  () => usePermissionStore.state.permissions.has(key) && !useLayoutStore.state.sidebarCollapsed,
  [key],
);
```

`create()` 回傳的 hook 本身也是 `StoreApi`（`getState` / `setState` / `subscribe` / `state` / `select`），
所以非 React 程式碼（plugin、`syncStore`）直接拿它用。不需要 hook 的 store（例：`packages/web-shared/src/channel/leader` 的選舉狀態）用 `createStore`。

### 2.0.2 CoreContext 的狀態

`createCoreContext()` 的 context 狀態就是一個 `createStore`（見 [02 §2](./02-plugin-system.md)）：
`context.state`、`context.prop(key, value?)`、`context.watch(getter, callback)`，plugin 的 `ctx.watch` 在該 plugin destroy 時自動停止。
React 端以 `useStore(context.state, (s) => s.x)` 讀取。

### 2.1 `web-core/store/` 的清單

| 檔案（hook）                                  | 內容                             | 持久化                      |
| --------------------------------------------- | -------------------------------- | --------------------------- |
| `permission`（`usePermissionStore`）          | `Set<PermissionKey>`、`hydrated` | ❌ 每次登入重新取得         |
| `layout`（`useLayoutStore`）                  | 側邊選單開合                     | ✅ localStorage（不跨分頁同步） |
| `preference`（`useLocaleStore`）              | 當前語系                         | ✅ localStorage ＋ 後端偏好 ＋ 跨分頁頻道 |
| `preference`（`useTimezoneStore`）            | 當前時區                         | ✅ localStorage ＋ 後端偏好 ＋ 跨分頁頻道 |
| `preference`（`useThemeStore`）               | 主題（淺色／深色／跟隨系統）     | ✅ localStorage ＋ 跨分頁頻道（只存本機，[07 §4.4](./07-ui-system.md)） |
| `preference`（`useHeaderToolbarStore`）       | 頂列工具的順序與隱藏項           | ✅ localStorage ＋ 跨分頁頻道（只存本機，[02 §4.4](./02-plugin-system.md)） |
| `tableColumnSettings`（`useTableColumnSettingsStore`） | 各表格的欄位顯示、順序、固定欄位、表頭固定（依 `tableId`）；釘選列只在本分頁的記憶體 | ✅ localStorage ＋ 跨分頁頻道 |

feature 自己的 store 放在 feature 裡（例：`features/file/preference.ts` 的檔案管理器排列方式，§5 的 `store:file-view:storage`）。
表格的篩選條件在網址上（[04 §3](./04-routing.md)），不另外存成預設值。

---

## 3. 權限 store — 唯一的例外

```ts
interface PermissionStore {
  hydrated: boolean;
  permissions: Set<PermissionKey>;
  setPermissions: (keys: PermissionKey[]) => void;
  clear: () => void;
}

export const usePermissionStore = create<PermissionStore>((set) => ({
  hydrated: false,
  permissions: new Set(),
  setPermissions: (keys) => set({ permissions: new Set(keys), hydrated: true }),
  clear: () => set({ permissions: new Set(), hydrated: false }),
}));
```

### 3.1 為什麼它可以是例外

| 理由                    | 說明                                                        |
| ----------------------- | ----------------------------------------------------------- |
| 必須同步讀取            | `can(key)` 出現在渲染路徑上，不能是 `useQuery` 的非同步結果 |
| 幾乎每個元件都讀        | 每個元件各自 `useQuery(profile)` 會讓 selector 難以精細化   |
| 需要 `Set` 的 O(1) 查找 | Query 的 `select` 每次都要重建                              |

### 3.2 兩個必須遵守的細節

**① 每次都建新的 `Set`。** `new Set(keys)` 而不是 `set.clear(); keys.forEach(...)`。
Store 用參照比較來決定是否通知訂閱者，原地修改不會觸發重渲染。

**② `hydrated` 必須被 UI 使用。** 只看 `permissions.size === 0` 無法區分
「還沒載入」與「這個人真的沒有任何權限」。前者應顯示骨架屏，後者應顯示空狀態。

### 3.3 生命週期

```
登入成功 / app 啟動且有 session
  → useSyncPermissions() 的 useQuery(profile) 成功
  → setPermissions(data.permissions)        hydrated = true

角色權限變更（自己受影響）
  → profile query 失效並重取 → setPermissions(...)

登出 / session 終止（web-core 的 SessionWatcher）
  → clear()                                 hydrated = false
  → queryClient.clear()
  → clearPinnedRowData()                    表格釘選列在記憶體裡的資料
```

**登出時 `queryClient.clear()` 是必要的**：否則下一個在同一個分頁登入的人會先
看到上一個人的快取資料。同理，任何以使用者身分取得、留在前端的資料都要在這裡清掉：
`SessionWatcher` 清權限、查詢快取與釘選列的資料；批次佇列與上傳暫存由各自的 plugin 訂閱同一個 `ended` 清除。

---

## 4. 儲存層

### 4.1 `@b2b-system/web-shared/storage`

```ts
/** 命名空間化的 localStorage，值自動 JSON 序列化，讀取失敗時回 fallback */
export function createDictStorage(namespace: string, options?: { channel?: Channel<DictStorageMessages> }): DictStorage;

interface DictStorage {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
  subscribe(key: string, fn: (value: unknown) => void): () => void; // 其他參與者改了 key
  dispose(): void; // 關閉頻道
}
```

- 命名空間前綴 `b2b-system:`，避免與同網域的其他東西衝突
- 所有讀取都包 `try/catch`：私密瀏覽模式、儲存空間已滿、使用者關閉 cookie
  都會讓 `localStorage` 拋例外。**拋例外時回 fallback，絕不讓 app 掛掉**
- `subscribe` 只通知 **其他參與者** 的修改（本實例自己的寫入不通知）：
  - 帶 `channel`：`set` / `remove` 後經頻道廣播，`subscribe` 聽頻道（§5「持久化狀態的同步」）
  - 沒帶：聽瀏覽器的 `storage` 事件

### 4.2 什麼可以放 localStorage，什麼不可以

| 可以                                               | 不可以                   |
| -------------------------------------------------- | ------------------------ |
| 語系、時區、側邊選單開合                           | **Access Token**         |
| 表格欄位設定、預設篩選                             | 任何個人識別資訊         |
| 「不要再顯示這個提示」的旗標                       | 權限集合（每次重新取得） |
| Refresh Token 的 **傳輸方式標記**（非 token 本身） | 任何伺服器資料的複本     |
| 跨分頁 leader 選舉的任期 counter（`b2b-system:leader:*:counter`，[11 §3.3](./11-realtime.md)） |                          |
| 命令面板「最近造訪」的 page key（不存名稱，[18 §3.3](./18-command-palette.md)） |                          |

**唯一的例外（IndexedDB，不是 localStorage）**：session 非自願結束時，選擇加入的表單的 **加密草稿**，24 小時過期（§4.4）。
它是個人資料與伺服器資料的複本，所以只在「回來的仍是同一個人」的結束原因保留、以不可匯出的金鑰加密，其他情況一律清除。

瀏覽器的 **HTTP 快取** 也是伺服器資料的複本：api 對一般 `GET` 回 `private, no-cache`（存著但每次重新驗證），身分、憑證、稽核回 `no-store`，
登出的回應以 `Clear-Site-Data: "cache"` 清掉整個網域的 HTTP 快取（[`../backend/03-api-conventions.md`](../backend/03-api-conventions.md) §9.1）。
前端在 **沒有 session 的期間**（登出、被撤銷、續期失敗之後）一律以 `cache: 'no-store'` 送出（`createHttpCacheInterceptor`，`web-core/plugins/fetcher/http-cache.ts`），
個別查詢要關掉快取時傳 `HttpRequestDTO.cache: 'no-store'`。

錯誤回報（`@sentry/browser`）的佇列只在記憶體，也不用 sessionStorage 串前一個 trace（[19 §4](./19-observability.md)）。

### 4.3 Token 的儲存

```
Access Token   → 只存在該後端 SessionStore 的閉包變數裡
                 重新整理頁面 = 消失 = 必須用 refresh token 重新取得
Refresh Token  → httpOnly cookie，JavaScript 讀不到
```

**沒有任何 token 進 `localStorage` 或 `sessionStorage`。** 這是對 XSS 的基本
防線：即使有腳本注入，也拿不走可長期使用的憑證。

代價：每次重新整理都要多一次 `POST /auth/refresh`（約 50 ms）。可接受。

---

### 4.4 session 結束時的表單草稿

session 中途結束時 `SessionWatcher` 清掉使用者資料、導向登入頁，表單內容原本全部遺失；登入在 apps/platform 的 OIDC 互動（頂層導向），
沒有就地重新登入。會遺失草稿的實際情境：refresh token 7 天沒用而過期、家族滿 30 天、在另一個分頁變更了密碼。

| 層 | 位置 | 職責 |
| --- | --- | --- |
| 儲存 | `web-shared/storage/draftStore.ts` | IndexedDB（`b2b-system:drafts`），WebCrypto AES-GCM 加密，金鑰是每個瀏覽器產生一次、**不可匯出** 的 `CryptoKey`（存在同一個 IndexedDB）；以「擁有者（`<租戶>:<使用者>`）× key」索引；24 小時過期、最多 20 筆、每筆 256 KiB（超過的不存）。沒有 IndexedDB 或 WebCrypto 時只在記憶體（等於不保留） |
| 機制 | `web-core/form/`（`useFormDraft`、`FormDraftNotice`、`formDrafts.ts`） | 表單逐一選擇加入；`SessionWatcher` 在 `ended` 時先同步取出每個 dirty 表單的內容再加密存起來；登入（`refreshed`）成為某個人時清掉其他人的草稿 |
| 表單 | 公告（建立、編輯）、Webhook（建立、編輯）、角色權限、使用者基本資料 | `useFormDraft({ key, values, dirty, onRestore })` ＋ `<FormDraftNotice draft={…} />` |

```tsx
const formDraft = useFormDraft({
  key: `user.detail:${user.id}`,                 // route id ＋ 實體 id
  values: { displayName, status, baseVersion },  // 含開始編輯時的 version：還原後送出照常以它做樂觀鎖
  dirty,
  onRestore: (saved) => { /* 合併回表單；saved 是 Partial（敏感與 exclude 的欄位已拿掉） */ },
});
<FormDraftNotice draft={formDraft} />           // 「有上次未儲存的內容（時間）」＋ 還原、捨棄
```

- **哪些原因保留**（`DRAFT_KEEPING_END_REASONS`）：`AUTH_REFRESH_EXPIRED`、`AUTH_REFRESH_INVALID`、`password_changed`——非自願、而且回來的仍是同一個人。
  其他原因（自己登出、單一登出、`main_session_ended`、`AUTH_REFRESH_REUSED`、`AUTH_TOKEN_STALE`、`AUTH_ACCOUNT_DISABLED`、`session.revoked`、換了身分）
  **不保留，並清掉那個人既有的草稿**：登出是使用者的意思（可能是共用電腦）；重用偵測、被停用、被撤銷代表帳號可能落在別人手上。
- **只在結束當下存**，不做定時自動儲存；只存 dirty 的表單。欄位名稱含 `password`、`secret`、`token` 的值一律不存，另可用 `exclude` 指定。
- **還原不自動套用**：重新登入回到 `redirect` 後，表單掛載時若有同一個人的草稿就顯示提示列，由使用者選「還原」或「捨棄」。
  還原後送出仍帶草稿時的 `version`，伺服器已更新時照常 `409`（[`../backend/03-api-conventions.md`](../backend/03-api-conventions.md) §11）。
- **擁有者**：`SessionStore.getLastIdentity()`（session 結束、token 清掉之後仍記得是誰）。登入成為不同的人時，上一個人的草稿全部清除。
- 加密讓磁碟上的資料不是明文（備份、鑑識、其他程式讀檔都看不到內容）；不可匯出的金鑰讓 XSS 帶不走金鑰——但能在頁面內解密，
  而 XSS 本來就讀得到畫面上的表單，沒有更差。
- 不採用的做法：就地重新登入（彈出視窗跑 OIDC：會被阻擋、要處理跨視窗的 PKCE 與「回來的是不是同一個人」，而且情境多半是分頁放了幾天）；
  伺服器端草稿（每種表單都要後端配合、未送出的個人資料存到伺服器）；sessionStorage 明文。

---

## 5. 跨分頁同步

所有同步訊息都經過 `@b2b-system/web-shared/channel` 的 `createChannel()`，**不直接 `new BroadcastChannel()`、
不直接聽 `storage` 事件、不直接在 WebSocket / worker 上自訂訊息格式**：

```ts
// 訊息型別 → payload 的對照表（用 type，interface 沒有隱含索引簽章）
type SessionMessages = {
  'refresh-done': { accessToken: string; expiresAt: number };
  'session-ended': { reason: string };
};

const channel = createChannel<SessionMessages>(`session:${name}`); // 實際頻道 ge:session:<name>
channel.on('session-ended', ({ reason }) => …);
channel.post('session-ended', { reason });
channel.close();
```

### 統一的使用方式：每個頻道有一個持有者

各功能用 Channel 的形狀一律如下；新增頻道照做，並補進下方「目前的頻道」表：

| # | 規則 | 理由 |
| - | ---- | ---- |
| 1 | 頻道的名稱與訊息型別只寫在 **一處**：持有者旁邊的 `XxxMessages` 型別 ＋ `createXxxChannel(…)` 工廠 | 搜尋名稱就找得到唯一的來源；傳輸層的限制（例：session 釘死 BroadcastChannel）寫在工廠裡，呼叫端改不掉 |
| 2 | 持有者從建構參數收下 `channel`（有預設值的用 `options.channel ?? createXxxChannel()`） | 測試以 `createFakeChannelHub()` 注入，模擬多個分頁 |
| 3 | **收下就負責關閉**：持有者的 `dispose()`（函式型則是回傳的 stop）呼叫 `channel.close()` | 不會有「誰該關」的疑問；呼叫端建好就交出去 |
| 4 | 只有持有者呼叫 `post` / `on`；其他人呼叫持有者的方法 | 訊息協定（去迴圈、驗證 payload、何時該送）集中在一處 |
| 5 | 由 plugin 管理生命週期的持有者：`start()` 開始收訊、`stop()` 停止（可再 `start()`）、`dispose()` 關閉頻道 | plugin 同步階段建立、`onInit` start、`onDestroy` stop 或 dispose |

模組層級的單例（`queryClient`、各後端的 `SessionStore`、偏好設定的 dictStorage）在載入時就建好頻道；
plugin 的 `onDestroy` 只 `stop()`，不 `dispose()`——app 重新建立時還要再 `start()`。

```ts
// 持有者（web-core/cache/AppQueryClient.ts）
export type QueryInvalidateMessages = { invalidate: readonly InvalidationTarget[] };
export function createQueryInvalidateChannel(options?: ChannelOptions) {
  return createChannel<QueryInvalidateMessages>('query-invalidate', options);
}

// 測試：兩個分頁
const hub = createFakeChannelHub();
const a = new AppQueryClient({ channel: createQueryInvalidateChannel({ transport: hub.transport() }) });
```

### 傳輸層

`createChannel(name, { transport })` 的 `transport` 決定訊息怎麼走；使用端的 `post` / `on` 寫法不變。

| 傳輸層                              | 範圍                         | 序列化          | 用在                                                         |
| ----------------------------------- | ---------------------------- | --------------- | ------------------------------------------------------------ |
| `broadcastChannelTransport()`（預設）| 本機同源分頁                 | structured clone | 一般跨分頁同步                                               |
| `storageTransport()`                | 本機同源分頁                 | JSON            | 沒有 `BroadcastChannel` 時的後備；訊息會短暫寫進 localStorage |
| `webSocketTransport(socket)`        | 跨裝置（經伺服器）           | JSON            | 原生 WebSocket 伺服器；本專案後端是 Socket.io，改用下一列     |
| `serverRelayTransport(realtime.relay)` | 跨裝置（經本專案後端）    | JSON            | 同一帳號在多台裝置即時同步；只轉白名單頻道（[11 §7](./11-realtime.md)） |
| `sharedWorkerTransport(worker)`     | 本機同源分頁（經 worker）    | structured clone | 需要一個跨分頁的單一執行者（例：只由 worker 維持連線）        |
| `serviceWorkerTransport()`          | SW 控制的分頁（經 SW）       | structured clone | SW 本身也要收發（例：背景同步後通知失效）                    |
| `fallbackTransport(a, b, …)`        | —                            | —               | 依序用第一個目前環境支援的                                   |
| `combineTransports(a, b, …)`        | —                            | —               | 同時走多條路（例：本機 BroadcastChannel ＋ 跨裝置 WebSocket） |

```ts
// 本機分頁即時、其他裝置經伺服器；同一則訊息兩條路都到只處理一次
createChannel('store:layout', {
  transport: combineTransports(broadcastChannelTransport(), webSocketTransport(socket)),
});
```

不論哪種傳輸層，`createChannel` 保證同樣的語意，傳輸層不必各做一次：

- 名稱加上 `ge:` 前綴；共用同一條連線（WebSocket、worker）時以名稱分流。
- **自己送出的訊息自己收不到**，即使被伺服器或 worker 轉回來（外框帶 `sender`）。
  本地要做的事在 `post` 前自己做。
- 同一則訊息從多條路送達只處理一次（外框帶 `id`）。
- 不是頻道外框、或不認得的 `type`（新舊版本並存、同一條連線上的其他協定）直接略過。
- 傳輸層不支援、送出失敗（分頁關閉中、斷線、payload 無法序列化）時不拋例外，視同沒有其他參與者。

中繼端（伺服器、worker）只需要認得外框（`isChannelEnvelope()`），不需要知道 payload：

| 中繼                 | 做法                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| WebSocket 伺服器     | 收到外框就原樣轉給該收的其他連線（例：同一使用者）；轉回發送者也沒關係             |
| SharedWorker         | `startChannelHub(self)`；或直接用 `createChannelHubWorker()`（`workers/channelHub.worker.ts`） |
| Service Worker       | 在 SW 腳本呼叫 `relayChannelMessages(self)`；非外框的訊息（含 MSW 的）不受影響       |

**選傳輸層的安全限制**：帶 token 或個人資料的頻道只能走 `broadcastChannelTransport()`——
`storageTransport` 會把訊息寫進 localStorage（§4.2），WebSocket 會把它送出本機。
`SessionStore` 因此明確指定傳輸層，而不是依賴預設值。

WebSocket 的連線由呼叫端建立、重連與關閉；頻道 `close()` 只取消訂閱。
連線中（`CONNECTING`）送出的訊息會排隊到 `open`，已關閉時丟棄。

### 持久化狀態的同步：帶頻道的 `dictStorage`

會寫進 localStorage 的狀態（偏好設定），由 **dictStorage 持有頻道**：寫入即廣播，其他分頁經 `subscribe` 收到值再放進 store。

```ts
// web-core/store/preference.ts
const storage = createDictStorage('preference', { channel: createPreferenceChannel() });

storage.subscribe('locale', (value) => {
  if (isLanguage(value)) useLocaleStore.setState({ locale: value }); // 其他分頁的值不信任型別
});
```

- 收訊方只通知訂閱者，**不再寫一次** localStorage：本機分頁共用同一份，發訊方已經寫過。
- 因此只適用本機分頁的傳輸層；跨裝置時各裝置的 localStorage 不共用，要改用 `syncStore` 並由收訊方自己持久化。
- 持久化與通知在同一個 `set()` 裡，不會「寫了沒廣播」或「廣播了沒寫」。

### Store 的同步

signal store（不經 dictStorage）要在所有參與者保持一致時，用 `@b2b-system/web-shared/store` 的 `syncStore()`，不自己訂閱頻道：

```ts
const stop = syncStore(useLayoutStore, ['collapsed'], createChannel('store:layout'));
// 跨裝置：createChannel 的第二個參數傳 { transport }
```

- 只同步列出的資料欄位；action 是函式，無法也不該傳遞。
- 收到的更新以 `setState` 套用、不再廣播，不會迴圈。
- 只同步 **之後的變更**；新分頁的初始值由持久化（`dictStorage`）水合。
  持久化寫在 action 裡的 store，本機分頁的收訊方不必再寫一次——發訊方已寫入共用的 localStorage；
  跨裝置時各裝置的 localStorage 不共用，收訊方要自己持久化。

### 跨分頁的單一狀態：`shareStore`

`syncStore` 只同步「之後的變更」，而且同時修改時各分頁以最後收到的為準、可能不一致。
狀態 **不持久化**、但所有分頁必須看到 **同一份** 時，改用 `@b2b-system/web-shared/store` 的 `shareStore()`：

```ts
const stop = shareStore(
  useEditorSessionStore,
  ['activeDocumentId', 'mode'],
  createChannel('shared:editor-session'),
);
// 跨裝置：createChannel 的第二個參數傳 { transport }，與 syncStore 相同
```

|                    | `syncStore`                              | `shareStore`                                              |
| ------------------ | ---------------------------------------- | --------------------------------------------------------- |
| 頻道               | `ge:store:<name>`                        | `ge:shared:<name>`                                        |
| 新分頁的初始值     | 由持久化（`dictStorage`）水合            | **加入時送 `snapshot-request`，向既有分頁要目前的快照**   |
| 同時修改           | 各自以最後收到的為準                     | **版本號 ＋ 寫入者 id**，所有分頁收斂到同一個值           |
| 適合               | 會寫進 localStorage 的狀態（本機分頁可直接用帶頻道的 `dictStorage`） | 不持久化、但必須全域一致的執行期狀態 |

規則（實作在 `packages/web-shared/src/store/shareStore.ts`）：

- 本地改到同步欄位 → 版本 +1 並廣播。收到的版本 **較新**（同版本時寫入者 id 較大）才套用，並採用對方的版本，
  所以之後的本地修改一定比收到的新（Lamport clock）；亂序晚到的舊版本會被略過。
- **只有改過狀態（版本 > 0）的分頁回覆快照**。沒人改過時新分頁保持自己的初始值——
  否則大家都回覆預設值，會依寫入者 id 隨機蓋掉彼此。
- 收到快照前的本地修改，若版本較舊會被快照覆蓋：已經有人改過的狀態優先。
- 與 `syncStore` 相同：只同步列出的資料欄位、收到的不再廣播、停止後不收發。

### 目前的頻道

| 頻道（`ge:` 之後）          | 訊息                            | 傳輸層             | 工廠 → 持有者                                 | 收訊期間 |
| --------------------------- | ------------------------------- | ------------------ | --------------------------------------------- | -------- |
| `session:<後端>`            | `refresh-done`、`session-ended` | BroadcastChannel（釘死） | `createSessionChannel` → `web-core/auth/SessionStore` | 建立起到 `dispose()` |
| `query-invalidate`          | `invalidate`                    | 預設（推播可用時不送） | `createQueryInvalidateChannel` → `web-core/cache/AppQueryClient` | cache plugin 的 `start()` / `stop()` |
| `leader:realtime:<後端>`    | `request-leader`、`leader-announcement`、`leader-heartbeat`、`leader-release` | 預設 | `createLeaderChannel` → `packages/web-shared/src/channel/leader` 的 `LeaderElection`（[11 §3.3](./11-realtime.md)） | realtime plugin |
| `realtime-control:<後端>`   | `resource-changed`、`resync`、`status`、`status-request` | 預設 | `createRealtimeControlChannel` → `web-core/realtime/RealtimeCoordinator`（[11 §3.4](./11-realtime.md)） | realtime plugin |
| `store:preference:storage`  | `set`、`remove`（`DictStorageMessages`） | 預設 | `createPreferenceChannel` → `web-core/store/preference` 的 dictStorage | 寫入即送；i18n plugin 訂閱（`syncPreferencesAcrossTabs`，含語系、時區、主題）；主題由 theme plugin 訂閱 store 套用 |
| `store:table-column-settings:storage` | `set`、`remove`（`DictStorageMessages`） | 預設（不經伺服器中繼） | `createTableColumnSettingsChannel` → `web-core/store/tableColumnSettings` 的 dictStorage | 寫入即送；表格掛載期間訂閱（`syncTableColumnSettings`） |
| `store:file-view:storage`   | `set`、`remove`（`DictStorageMessages`） | 預設（不經伺服器中繼；只同步本機分頁） | `createFileViewPreferenceChannel` → backstage `features/file/preference.ts` 的 dictStorage | 寫入即送；檔案管理器頁掛載期間訂閱（`syncFileViewPreference`） |
| `batch-queue`               | `snapshot`、`snapshot-request`、`host-closed` | 預設（BroadcastChannel，不經伺服器；項目名稱含 email） | `createBatchQueueChannel` → `web-core/batch` 的 `BatchQueueHost`（worker 內，送快照）與每個分頁的 `BatchQueueClient`（收快照、送 request） | batch-queue plugin 的 `start()` / `stop()`；指令與逐筆執行走 worker 的 port，不走頻道（[`frontend/07-ui-system.md`](07-ui-system.md) §13） |

目前沒有 store 使用 `syncStore` / `shareStore`（偏好設定由 dictStorage 同步）；新增時把頻道補進上表。

續期結果與登出放在 **同一個頻道**：同一頻道的訊息依序送達，登出之後才到的續期結果不會排在登出前面。

`SessionStore` 每個後端一個實例（[05 §3.5](./05-data-layer.md)），頻道名稱與
localStorage 的 `hasSession` 旗標（`b2b-system:auth:<後端>:hasSession`）都帶後端名稱：
同一後端在不同分頁之間協調，不同後端之間完全不互相收訊息。

### 5.1 Token 續期的單飛（最重要的一個）

Refresh token 是 **輪替** 的：用過一次就作廢，後端會換發新的。如果兩個分頁同時
拿同一個舊 token 去續期，第二個會被判定為「重用攻擊」，**整條 token 家族被撤銷，
使用者被登出**。

```
任一分頁需要續期
  ├─ 檢查本地 in-flight promise → 有則共用（分頁內單飛）
  ├─ navigator.locks.request('ge:refresh:<name>')  ← 跨分頁互斥，其他分頁在這裡排隊
  │    ├─ 拿到鎖時 session 已結束（世代不同）→ 放棄
  │    ├─ 拿到鎖時 token 已新鮮（其他分頁的 refresh-done 已到）→ 直接採用，不打 API
  │    ├─ 實際打 POST /auth/refresh
  │    └─ 廣播 { type: 'refresh-done', accessToken, expiresAt }
  └─ 釋放鎖
```

**為什麼用 Web Locks 而不是只靠 `BroadcastChannel`**：廣播是非同步送達的，
「看有沒有人在續期」與「宣告我要續期」之間有空窗。闔上筆電再打開時，所有分頁
會同時醒來、同時續期，各自都還沒收到別人的宣告，就拿同一個舊 cookie 去打 API。
Web Locks 保證同一時間只有一個分頁在續期；而且下一個分頁拿到鎖時，前一個分頁的
回應已經寫入新的 refresh cookie，就算 `refresh-done` 還沒送到、它再打一次也是用
新 cookie，不會被判定為重用。不支援 Web Locks 的瀏覽器退回只有分頁內單飛。

**續期失敗不一定是 session 結束。** 只有伺服器明確拒絕（401、`AUTH_REFRESH_*`、
`AUTH_ACCOUNT_DISABLED`，即 `isSessionRejected()`）才結束 session；網路錯誤、5xx、
`429 RATE_LIMITED`、逾時都是暫時性的，保留 session，錯誤照常回報給這次請求，
下一個請求會再試一次續期（冪等請求由 `retry.ts` 自動重試）。否則一次網路抖動
就會把使用者登出。

**晚回來的續期不能救活已結束的 session。** `SessionStore` 每次清空 session 就把
世代（`epoch`）加一；續期回來時世代不同就丟掉結果。其他分頁的 `refresh-done`
與 `session-ended` 走同一個頻道、依序送達，已結束的分頁不採用之後才到的 token。

### 5.2 登出廣播

```ts
channel.post("session-ended", { reason });
// 其他分頁：clear permission store → queryClient.clear() → navigate('/auth/login')
```

登出的順序是 **先結束前端、再撤銷後端**（各 app 的 `useLogoutMutation` → web-core 的 `signOut`）：

1. `ensureAccessToken()`：等手上的續期結束，取得目前的 token
2. `endSession('logout')`：中止帶身分的請求、清掉 token、廣播、導回登入頁
3. 用第 1 步的 token 走 base 管道打 `POST /auth/logout`，撤銷整條家族；續期失敗拿不到 token 時改以 refresh cookie
   （`x-refresh-request: 1`）。請求帶 `keepalive`，關分頁也會送完
4. 第 3 步失敗：已登出頁加上 `?logout=incomplete`，顯示警示與「重試登出」（[`../04-sso.md`](../04-sso.md) §3.4）

反過來（先打 API、回應後才結束 session）的話，等待期間完成的續期會把新 token
寫回已登出的頁面。

---

## 6. 表單狀態

用 TanStack Form，**不放進全域 store**：

```tsx
const form = useForm({
  defaultValues: { name: "", description: "", permissionKeys: [] as string[] },
  validators: { onSubmit: RoleCreateSchema }, // Zod
  onSubmit: async ({ value }) => {
    await createRole.mutateAsync({ params: value });
  },
});
```

### 6.1 伺服器端欄位錯誤回填

```ts
onError: (error) => {
  if (error instanceof AppError && error.details?.fields) {
    for (const [field, message] of Object.entries(error.details.fields)) {
      form.setFieldMeta(field, (m) => ({ ...m, errors: [message] }));
    }
    return; // 不顯示 toast——錯誤已經在欄位上了
  }
  toast.error(getErrorMessage(error));
};
```

### 6.2 未儲存變更的保護

```tsx
useBlocker({
  shouldBlockFn: () => form.state.isDirty && !form.state.isSubmitting,
  withResolver: true,
});
```

實際的寫法是 `web-core/router` 的 `useUnsavedChangesGuard(dirty)`（對話框裡用 `useDialogUnsavedGuard`）：TanStack Router 的 `useBlocker`
攔截路由離開，先問「要放棄變更嗎？」；重新整理或關分頁則以 `enableBeforeUnload` 交給瀏覽器原生的 `beforeunload` 提示（只能顯示制式訊息）。
session 結束時的導向帶 `ignoreBlocker`，這兩個保護都留不住使用者——選擇加入的表單改由 §4.4 的草稿保留內容。

---

## 7. 常見錯誤

| ❌                                       | ✅                                          |
| ---------------------------------------- | ------------------------------------------- |
| 把使用者列表複製進 store                 | 留在 Query 裡                               |
| 用 `useState` 存目前頁碼                 | 放網址（`validateSearch`）                  |
| 直接讀 `localStorage.getItem()`          | 用 `dictStorage`（有 try/catch 與命名空間） |
| Access Token 存 `localStorage`           | 只存記憶體                                  |
| `permissions.clear(); keys.forEach(add)` | `new Set(keys)`                             |
| 用 `permissions.size === 0` 判斷載入中   | 用 `hydrated`                               |
| 登出時只清 permission store              | 同時 `queryClient.clear()`                  |
| 每個分頁各自續期 token                   | Web Locks 跨分頁互斥 ＋ `refresh-done` 廣播 |
| 登出時先打 API、回應後才清 session       | 先 `endSession`，再用擷取的 token 撤銷後端  |
| 直接 `new BroadcastChannel()` / 聽 `storage` 事件 | `createChannel()`，由一個持有者收下（§5）；持久化狀態用帶頻道的 `dictStorage`，store 用 `syncStore()` |
| 帶 token 的頻道走預設或 localStorage     | 明確指定 `broadcastChannelTransport()`      |

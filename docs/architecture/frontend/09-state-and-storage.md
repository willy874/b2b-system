# 前端 09 — 狀態與儲存

## 1. 狀態的四個去處

| 類型           | 去處                        | 生命週期     | 例                             |
| -------------- | --------------------------- | ------------ | ------------------------------ |
| 伺服器狀態     | TanStack Query              | 快取管理     | 使用者列表、角色詳情           |
| 網址狀態       | Router `validateSearch`     | 跟著網址     | 分頁、篩選、排序               |
| 全域客戶端狀態 | `shared/store` signal store | 整個 session | 權限集合、語系、時區、選單開合 |
| 區域狀態       | `useState` / `useReducer`   | 元件         | 對話框內的表單草稿、hover      |

**選擇順序**：能放網址就放網址 → 能放 Query 就放 Query → 需要同步讀取且跨元件
才放 store → 其餘 `useState`。

> 最常見的錯誤是把伺服器資料複製到 store 裡。那會製造兩份真相。唯一的例外是
> 權限集合（見 §3）。

---

## 2. Signal store

`shared/store` 是一個約 100 行的極簡 store，介面刻意與 Zustand 相容：

```ts
export const useLayoutStore = create<LayoutStore>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));

// 讀取時一律用 selector，避免無關欄位變動造成重渲染
const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
```

### 2.1 `core/store/` 的清單

| Store                 | 內容                             | 持久化                      |
| --------------------- | -------------------------------- | --------------------------- |
| `permission`          | `Set<PermissionKey>`、`hydrated` | ❌ 每次登入重新取得         |
| `layout`              | 側邊選單開合、密度               | ✅ localStorage             |
| `locale`              | 當前語系                         | ✅ localStorage ＋ 後端偏好 |
| `timezone`            | 當前時區                         | ✅ localStorage ＋ 後端偏好 |
| `tableColumnSettings` | 各表格的欄位顯示與順序           | ✅ localStorage             |
| `tableFilterSettings` | 各表格的預設篩選                 | ✅ localStorage             |

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

登出 / session 終止
  → clear()                                 hydrated = false
  → queryClient.clear()
```

**登出時 `queryClient.clear()` 是必要的**：否則下一個在同一個分頁登入的人會先
看到上一個人的快取資料。

---

## 4. 儲存層

### 4.1 `shared/storage`

```ts
/** 命名空間化的 localStorage，值自動 JSON 序列化，讀取失敗時回 fallback */
export function createDictStorage(namespace: string): DictStorage;

interface DictStorage {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
  subscribe(key: string, fn: (value: unknown) => void): () => void; // 跨分頁
}
```

- 命名空間前綴 `game-editor:`，避免與同網域的其他東西衝突
- 所有讀取都包 `try/catch`：私密瀏覽模式、儲存空間已滿、使用者關閉 cookie
  都會讓 `localStorage` 拋例外。**拋例外時回 fallback，絕不讓 app 掛掉**
- `subscribe` 監聽 `storage` 事件，讓 A 分頁改的偏好在 B 分頁立即生效

### 4.2 什麼可以放 localStorage，什麼不可以

| 可以                                               | 不可以                   |
| -------------------------------------------------- | ------------------------ |
| 語系、時區、側邊選單開合                           | **Access Token**         |
| 表格欄位設定、預設篩選                             | 任何個人識別資訊         |
| 「不要再顯示這個提示」的旗標                       | 權限集合（每次重新取得） |
| Refresh Token 的 **傳輸方式標記**（非 token 本身） | 任何伺服器資料的複本     |

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

## 5. 跨分頁同步

所有跨分頁訊息都經過 `shared/channel` 的 `createTabChannel()`，**不直接 `new BroadcastChannel()`**：

```ts
// 訊息型別 → payload 的對照表（用 type，interface 沒有隱含索引簽章）
type SessionMessages = {
  'refresh-done': { accessToken: string; expiresAt: number };
  'session-ended': { reason: string };
};

const channel = createTabChannel<SessionMessages>(`session:${name}`); // 實際頻道 ge:session:<name>
channel.on('session-ended', ({ reason }) => …);
channel.post('session-ended', { reason });
channel.close();
```

它統一處理每個使用者原本各寫一次的細節：`ge:` 命名空間、依 `type` 分派、
不支援 `BroadcastChannel` 時退化成只在本分頁運作、分頁關閉中 `postMessage` 拋例外時忽略、
收到格式不符或未知 `type`（新舊版本分頁並存）時略過。
**自己送出的訊息自己收不到**（`BroadcastChannel` 的語意），本分頁要做的事在 `post` 前自己做。

### Store 的跨分頁同步

signal store 要在所有分頁保持一致時，用 `shared/store` 的 `syncAcrossTabs()`，不自己開頻道：

```ts
const stop = syncAcrossTabs(useLocaleStore, 'preference:locale', ['locale']);
```

- 只同步列出的資料欄位；action 是函式，無法也不該跨分頁傳遞。
- 收到的更新以 `setState` 套用、不再廣播，不會迴圈。
- 只同步 **之後的變更**；新分頁的初始值由持久化（`dictStorage`）水合。
  持久化寫在 action 裡的 store，收訊方不必再寫一次——發訊方已寫入共用的 localStorage。

### 目前的頻道

| 頻道（`ge:` 之後）             | 訊息                              | 位置                                   |
| ------------------------------ | --------------------------------- | -------------------------------------- |
| `session:<後端>`               | `refresh-done`、`session-ended`   | `core/auth/SessionStore`               |
| `query-invalidate`             | `invalidate`                      | `core/cache/broadcastInvalidate`       |
| `store:preference:locale`      | `state`（`syncAcrossTabs`）       | `core/store/preference`，由 i18n plugin 啟動 |
| `store:preference:timezone`    | `state`（`syncAcrossTabs`）       | 同上                                   |

續期結果與登出放在 **同一個頻道**：同一頻道的訊息依序送達，登出之後才到的續期結果不會排在登出前面。

`SessionStore` 每個後端一個實例（[05 §3.5](./05-data-layer.md)），頻道名稱與
localStorage 的 `hasSession` 旗標（`game-editor:auth:<後端>:hasSession`）都帶後端名稱：
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

登出的順序是 **先結束前端、再撤銷後端**（`useLogoutMutation`）：

1. `ensureAccessToken()`：等手上的續期結束，取得目前的 token
2. `endSession('logout')`：中止帶身分的請求、清掉 token、廣播、導回登入頁
3. 用第 1 步的 token 走 base 管道打 `POST /auth/logout`，撤銷整條家族

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

TanStack Router 的 `useBlocker` 會攔截路由離開。**只攔截路由，不攔截關閉分頁**
（`beforeunload` 在現代瀏覽器只能顯示制式訊息，而且會干擾 E2E 測試）。

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
| 直接 `new BroadcastChannel()`            | `createTabChannel()`；store 用 `syncAcrossTabs()` |

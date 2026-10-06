# 前端 05 — 資料層

## 1. 三層結構

```
頁面 / hook
    │  useQuery(getRoleListQueryOptions({ params }))
    ▼
apis/role/get-role-list/query.ts        ← TanStack Query options（query key、快取策略）
    │  fetchRoleListQuery({ params, signal })
    ▼
apis/role/get-role-list/fetcher.ts      ← defineAuthFetcher，呼叫 api-sdk
    │
    ▼
web-core/client (HttpContext + 攔截器鏈)     ← 認證、續期、重試、錯誤轉換
    │
    ▼
packages/api-sdk                        ← 由 OpenAPI 產生
    │
    ▼
fetch('/api/roles?...')
```

**分層的價值**：頁面只認識 query options。要換 HTTP 客戶端、要加一層攔截器、
要改認證方式，頁面一行都不用動。

---

## 2. 目錄慣例

```
apis/<domain>/<operation>/
├── fetcher.ts     一定有
├── query.ts       讀取操作
└── mutation.ts    寫入操作
```

`<operation>` 用動詞開頭的 kebab-case，對應後端端點語意：

```
apis/role/
├── get-role-list/
├── get-role-detail/
├── get-role-permissions/
├── create-role/
├── update-role/
├── delete-role/
├── grant-role-permissions/
└── duplicate-role/
```

> **為什麼一操作一資料夾**：只用到列表的頁面不應該把刪除、建立的程式碼打包
> 進去。細粒度的模組邊界讓 bundler 能真正做 tree shaking。

> **例外：多步驟操作**。檔案上傳要依序打「登記 → 直傳到物件儲存 → 完成」三個端點，
> 單獨呼叫任一步都沒有意義，所以只有一個 `apis/file/upload-file/`，對外提供 `uploadFile()`；
> 兩個後端步驟放在同資料夾的 `steps.ts`。見 [`../backend/09-file.md`](../backend/09-file.md) §5。

---

## 3. `fetcher.ts`

```ts
// apis/role/get-role-list/fetcher.ts
import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { getRoleControllerListUrl } from '@/shared/api-sdk';
import type { RoleControllerListResponse } from '@/shared/api-sdk';

export const fetchRoleListQuery = defineAuthFetcher<
  HttpRequestDTO<RoleListParams>,
  RoleControllerListResponse['data']
>((http, request) =>
  http.request(withQuery(getRoleControllerListUrl(), { ...request.params }), { method: 'GET' }),
);
```

`http` 是已綁定呼叫端 `signal` 的 `HttpClient`，fetcher **不需要、也不應該** 自己把
`signal` 傳給 `fetch`（見 §3.2）。

### 3.1 `defineAuthFetcher` vs `defineBaseFetcher`

|                     | 管道          | 掛上的攔截器                                | 用於                                      |
| ------------------- | ------------- | ------------------------------------------- | ----------------------------------------- |
| `defineBaseFetcher` | `main:base`   | retry、錯誤轉換                             | `/auth/login`、`/auth/refresh`、`/health` |
| `defineAuthFetcher` | `main:auth`   | 上述 ＋ `ensureAccessToken` ＋ 401 續期重放 | 其餘全部                                  |

這兩個是 **主後端** 的定義器；其他後端見 §3.5。

用錯會造成死結：登入端點若用 `defineAuthFetcher`，它會先嘗試取得 access token
（還沒有），觸發續期（沒有 refresh token），失敗 → 登入永遠打不出去。

### 3.2 `HttpRequestDTO`

```ts
export interface HttpRequestDTO<P = unknown> {
  params: P;
  signal?: AbortSignal; // ★ TanStack Query 會傳入；mutation 需要可取消時自行傳入
}
```

`signal` 由 `defineXxxFetcher` 統一接到 `HttpContext.bind(signal)`，一路傳到 `fetch`
與每個攔截器的等待（續期、重試退避）。否則使用者快速切換篩選時，舊請求不會被取消，
可能造成「後回來的舊回應覆蓋新回應」。

### 3.3 請求中止

每個請求在 `HttpContext` 裡都有 **自己的 `AbortController`**，合併三個來源，
攔截器從 `FetcherRequest.signal` 讀到的就是它：

| 來源 | `AbortReason` | 觸發 |
| ---- | ------------- | ---- |
| 呼叫端 signal | `caller` | TanStack Query 取消、元件卸載、呼叫端自己 `abort()` |
| 逾時 | `timeout` | `HttpContextOptions.timeoutMs`（兩個管道皆 30 秒，含續期等待與重試） |
| 中止匯流排 | 廣播帶的 reason | `abortRequests({ reason, contexts?, detail? })` |

```
某個後端的 SessionStore 'ended'
  │  httpContextPlugin 訂閱
  ▼
abortRequests({ reason: 'session-ended', contexts: ['<後端>:auth'], detail: <原因碼> })
  │  requestAbortBus（web-core/client/abort.ts）
  ▼
該後端每個進行中的 auth 請求 → controller.abort(new RequestAbortedError(...))
  ├─ fetch 立刻 reject
  ├─ 等待中的續期（raceAbort）、重試退避（abortableDelay）立刻結束
  └─ 錯誤攔截器不再執行（不續期、不重試）
```

- 中止後一律以 `RequestAbortedError { reason, detail }` reject，不外露 `DOMException`；
  伺服器已回應的 `AppError` 保留原樣。
- 共用的非同步工作（跨分頁單飛續期）不會因為某一個請求被中止而取消，只是那個請求不再等它。
- 請求結束（成功、失敗、中止）時退訂匯流排並清掉計時器。
- 新的中止時機（例：切換租戶）只要呼叫 `abortRequests()`，不必改任何 fetcher。

### 3.4 傳輸層失敗

`fetch` 在離線、DNS、CORS、連線中斷時只丟一個沒有區別性的 `TypeError`。`HttpContext`
把它換成 `NetworkError`（原始錯誤放在 `cause`），因此：

- `retry.ts` 只重試 `NetworkError` 與 5xx，**程式錯誤（其他 `TypeError`）不會被當成網路問題重送**；
- UI 顯示 `error.network`，而不是「未預期的錯誤」。

### 3.5 多個後端（各自獨立登入）

每個後端有 **自己的 session 與自己的兩個管道**，生命週期互不相干：

| 後端的東西     | 名稱                                          | 建立者                          |
| -------------- | --------------------------------------------- | ------------------------------- |
| session        | `SessionStore(<後端>)`（`getSessionStore()`） | `httpContextPlugin`             |
| 管道           | `<後端>:base`、`<後端>:auth`                  | `httpContextPlugin`             |
| fetcher 定義器 | `defineBackendFetchers(<後端>)`               | 該後端的 `apis/<domain>/`       |
| 續期實作       | `BackendOptions.refresh`                      | `main.tsx` 注入（plugin 不認識 `apis/`） |

```ts
// main.tsx
.use(httpContextPlugin([
  { name: MAIN_BACKEND, baseUrl: ENV.API_BASE_URL, refresh: refreshMain },
  { name: 'reports', baseUrl: ENV.REPORTS_API_BASE_URL, refresh: refreshReports },
]))

// apis/report/backend.ts
export const { defineBaseFetcher, defineAuthFetcher } = defineBackendFetchers('reports');
```

| 事件                     | 影響範圍                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------- |
| 某後端 401 → 續期        | 只續期該後端的 session；跨分頁單飛也只在同一後端之間協調                          |
| 其他後端的 session 結束  | 只中止 `<後端>:auth` 的請求；**不** 登出 app，由 feature 訂閱該 session 的 `ended` 決定 UI |
| 主後端的 session 結束    | 登出整個 app（[04 §4.3](./04-routing.md)），並 **一併結束其他後端的 session**      |

主 session 結束時連帶結束其他 session，是因為「登出 app」代表換人：若保留，下一個在同一台
瀏覽器登入的人會沿用上一個人在其他後端的 access token。結束後 `hasSession` 旗標為 false，
也不會再拿殘留的 refresh cookie 自動續期；要讓伺服器端也失效，feature 的登出流程應呼叫
該後端的 logout 端點。

- 其他後端的登入：該 feature 呼叫自己的 login fetcher（`defineBaseFetcher`），成功後
  `getSessionStore('<後端>').setTokens(...)`；畫面用 `useHasSession(getSessionStore('<後端>'))`。
- 跨網域的後端：refresh cookie 要能送出，fetcher 需用 `credentials: 'include'`，
  後端 CORS 需允許 credentials。

UI 端：`isSilentError(error)` 對 `caller`、`session-ended` 回 `true`（使用者不需要知道）；
`timeout` 顯示 `error.timeout`。mutation 的 `onError` 用 `useErrorToast()`，它會略過 silent 錯誤。

---

## 4. `query.ts`

```ts
// apis/role/get-role-list/query.ts
import { keepPreviousData, queryOptions, infiniteQueryOptions } from "@tanstack/react-query";
import { fetchRoleListQuery } from "./fetcher";

export const ROLE_LIST_QUERY_KEY = "ROLE_LIST_QUERY_KEY";

const getRoleListQueryKeys = (p: ListRolesRequest) =>
  // 陣列參數（多欄排序）先轉成字串，key 裡只放扁平的原始值
  [ROLE_LIST_QUERY_KEY, p.offset, p.limit, p.keyword, p.sort ? toSortParams(p.sort).join(",") : ""] as const;

export const getRoleListQueryOptions = (options: HttpRequestDTO<ListRolesRequest>) =>
  queryOptions({
    queryKey: getRoleListQueryKeys(options.params),
    placeholderData: keepPreviousData, // 換頁時不閃空白
    queryFn: ({ signal }) => fetchRoleListQuery({ signal, params: options.params }),
  });

// 型別化的 query key 註冊（讓失效工具能推導）
declare module "@b2b-system/web-core/cache/queryClient" {
  interface QueryKeysMap {
    role_list: ReturnType<typeof getRoleListQueryKeys>;
  }
}
```

### 4.1 Query key 規則

| 規則                                          | 說明                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| 第一個元素是 SCREAMING_SNAKE 常數             | 供 `invalidateQueries({ queryKey: [ROLE_LIST_QUERY_KEY] })` 做前綴失效 |
| 其餘元素是 **扁平的原始值**，不放物件         | 物件的參照不穩定會造成無限重取                                         |
| 順序固定，由 `getXxxQueryKeys()` 單一函式產生 | 避免兩處手寫出不同順序                                                 |
| `as const`                                    | 讓 `queryFn` 能從 key 解構出正確型別                                   |

### 4.2 infinite query（下拉選單用）

選擇器需要無限捲動的角色清單，與列表頁的分頁查詢 **key 前綴不同**，
刻意不共用快取：

```ts
export const ROLE_OPTIONS_INFINITE_QUERY_KEY = "ROLE_OPTIONS_INFINITE_QUERY_KEY";
```

理由：列表頁的失效不該連帶清掉選擇器的快取，反之亦然。兩者的資料新鮮度要求
不同。

---

## 5. `mutation.ts`

```ts
// apis/role/create-role/mutation.ts
import { mutationOptions } from "@tanstack/react-query";
import { fetchRoleCreateMutation } from "./fetcher";

export const getRoleCreateMutationOptions = () =>
  mutationOptions({ mutationFn: fetchRoleCreateMutation });
```

**`apis/` 層的 mutation options 只有 `mutationFn`。**
`onSuccess` 的失效、toast、導覽都屬於業務決定，放在 feature 的
`hooks/useRoleCreateMutation.ts`（見 [`03-feature-anatomy.md`](./03-feature-anatomy.md) §3.1）。

---

## 6. 快取策略

`web-core/cache/queryClient.ts`：

```ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30 秒內視為新鮮，不重取
      gcTime: 5 * 60_000,
      retry: false, // 重試交給 web-core/plugins/fetcher/retry.ts（它懂哪些該重試）
      refetchOnWindowFocus: true,
      throwOnError: false, // 錯誤由 UI 呈現，不炸到 error boundary
    },
    mutations: { retry: false },
  },
});
```

### 6.1 各類資料的新鮮度

| 資料                            | `staleTime`                     | 理由                      |
| ------------------------------- | ------------------------------- | ------------------------- |
| 列表（user / role / audit-log） | 30 s（預設）                    | 變動頻繁                  |
| 詳情                            | 30 s                            | 同上                      |
| `GET /auth/profile`             | 5 min ＋ `refetchOnWindowFocus` | 權限變更的偵測窗口，見 §8 |
| `GET /permissions`（權限目錄）  | `Infinity`                      | 一個部署版本內不會變      |

### 6.2 資源依賴圖（取代手列 query key）

寫入後 **不手列要失效的 query key**，改成宣告「後端改了什麼」，由依賴圖換算：

```ts
// features/role/hooks/useRoleMutations.ts
onSuccess: (role) => {
  invalidateResources([{ resource: Resource.ROLE, kind: 'update', id: role.id }]);
},
```

| 檔案                              | 職責                                                                 |
| --------------------------------- | -------------------------------------------------------------------- |
| `web-core/cache/resourceGraph.ts`     | 通用引擎：來源變更 → 失效目標（不認識任何業務 key）                  |
| `apis/resources.ts`               | 本專案的依賴宣告：每個資源有哪些 query、由哪些來源衍生               |
| `web-core/cache/AppQueryClient.ts`    | `queryClient` 的 class：套用失效目標並跨分頁廣播（§6.3）            |

#### 邏輯線

```
mutation 成功
  │  宣告來源變更 { resource, kind, id?, refs? }
  ▼
① 資源自己的 query
     create        → collection
     update(id)    → collection ＋ entity(id)
     delete(id)    → collection ＋ 移除 entity(id)（不重抓，避免 404）
② 直接衍生自該來源的資源（反向索引查表，一層）
     id: 'self'    → 同一筆
     id: 'ref'     → change.refs[本資源]；沒給就退回整個前綴
     id: 'none'    → 只有 collection
③ derivesFromAnyChange（稽核列表；`{ except: [...] }` 排除的來源不算）
④ scopedCollection：自己的變更帶了 refs[範圍]，collection 只失效 [KEY, 範圍] 與 [KEY, 不分範圍]
  │
  ▼
去重（前綴已失效就不列單筆）→ invalidate / remove → 廣播
```

**為什麼不會大規模擴散**：

- **只走一層、不遞移。** 衍生資料（角色的 `userCount`）變了，不等於嵌入角色摘要的使用者也變了；
  真的有關係就直接宣告到來源上。因此沒有循環，也沒有「一路傳下去」的連鎖。
- **查表而非搜尋。** 建圖時就產生「來源 → 衍生規則」的反向索引，一筆變更的成本只跟該來源的邊數有關。
- **精準到筆。** 呼叫端知道連帶影響哪幾筆時用 `refs` 告知（例：指派角色時的新舊角色），
  只有不知道時才退回前綴失效；前綴失效也只會重抓 **畫面上正在用** 的 query。

#### 資源與來源

| 資源（query）                                                                  | 衍生自                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `user`：`USER_LIST` ／ `USER_DETAIL`、`USER_ROLES`                              | `userRole`（同一人）、`role` 更新／刪除（持有者，未知 → 全部）                        |
| `role`：`ROLE_LIST`、`ROLE_OPTIONS` ／ `ROLE_DETAIL`、`ROLE_PERMISSIONS`、`ROLE_USERS` | `rolePermission`（同一角色）、`userRole`（新舊角色）、`user`（該使用者持有的角色） |
| `group`：`GROUP_LIST`、`GROUP_OPTIONS` ／ `GROUP_DETAIL`、`GROUP_MEMBERS`、`GROUP_ROLES` | `user` 更新／刪除（成員清單的名稱，未知 → 全部）、`role` 更新／刪除（持有的角色清單） |
| `profile`：`AUTH_PROFILE`                                                      | `user` 更新（自己）、`userRole`（自己）、`role` 更新／刪除與 `rolePermission`（自己持有的角色）、`group` 的任何變更（前端不知道自己間接在哪些群組；[`../../rbac/08-groups.md`](../../rbac/08-groups.md) §4） |
| `authzExplain`：`PERMISSION_SOURCES`、`FILE_FOLDER_EXPLAIN`（前端專屬）          | `user` 更新／刪除、`userRole`、`role` 更新／刪除、`rolePermission`、`group`、`fileFolder`：整批（說明只在展開時查；[`../../rbac/09-explain.md`](../../rbac/09-explain.md) §5） |
| `auditLog`：`AUDIT_LOG_LIST` ／ `AUDIT_LOG_DETAIL`                              | **任何寫入**（只影響列表；既有紀錄不可變），`notification` 除外（不寫稽核）          |
| `approval`：`APPROVAL_LIST` ／ `APPROVAL_DETAIL`                                | 無（只有自己的寫入）                                                                  |
| `file`：`FILE_LIST`、`FILE_INFINITE_LIST` ／ `FILE_DETAIL`                      | `fileFolder` 更新／刪除（全部列表）；檔案內容 `FILE_TEXT` 刻意不列——以 id 為 key、不可變。列表的 key 第二個元素是資料夾（`scopedCollection`）：推播帶 `refs.fileFolder` 時只重抓那個資料夾與不分資料夾的列表 |
| `fileStorageUsage`：`FILE_STORAGE_USAGE`（前端專屬）                            | 無：刻意不跟著 `file` 失效（任何人的檔案變動都會推播，跟著重抓等於「推播數 × 分頁數」次 upload-policy）。只在自己的上傳結束時宣告；別人造成的變化等 staleTime 過後、切回分頁時重抓（[`../05-tenancy.md`](../05-tenancy.md) §13.3 D8） |
| `permission`：`PERMISSION_LIST`                                                | 無（一個部署版本內不變）                                                              |
| `notification`：`NOTIFICATION_LIST`、`NOTIFICATION_UNREAD_COUNT`                | 無（只有自己的已讀與伺服器推來的新通知；[`15-notification.md`](./15-notification.md) §6） |

`userRole`、`rolePermission`、`userCredential` 是 **關係／純來源**：沒有自己的 query，只用來描述寫入。

#### 各操作宣告的來源

| 操作                     | 來源變更                                                                 |
| ------------------------ | ------------------------------------------------------------------------ |
| 建立 / 複製角色          | `role` create                                                            |
| 更新 / 刪除角色          | `role` update / delete（id）                                             |
| 變更角色權限             | `rolePermission` update（roleId）                                        |
| 建立 / 更新 / 解鎖使用者 | `user` create / update（id），`refs.role` = 該使用者持有的角色            |
| 刪除使用者               | `user` delete（id）                                                      |
| 指派使用者角色           | `userRole` update（userId），`refs.role` = 新舊角色聯集                   |
| 重設使用者密碼           | `userCredential` update（userId）                                        |
| 核准審批                 | `approval` update（id）；`user.register` 另宣告 `user` create（新帳號 id），`refs.role` = 指派的角色 |
| 駁回審批                 | `approval` update（id）                                                  |
| 修改自己的 profile / 偏好 | `user` update（自己的 id），`refs.role` = 自己的角色（`selfUpdated()`）   |
| 通知標為已讀 / 全部已讀  | `notification` update（通知 id / 不帶）                                   |

「自己」的判斷讀 profile 快取；沒有快取時一律視為是（profile 只有一個 query，寧可多抓一次）。

#### 新增一支 query 或一種寫入

1. 新 query：把 key 放進 `apis/resources.ts` 對應資源的 `collection` 或 `entity`
   （`entity` 的 key 第二個元素必須是 id）。列表天生分範圍、而且變更知道自己落在哪個範圍時（例：檔案 → 資料夾），
   把範圍放在 key 的第二個元素並宣告 `scopedCollection`，別的範圍的列表就不會跟著重抓。
2. 新的衍生關係：在 **被影響的資源** 上加 `derivesFrom`，並註解「為什麼」。
3. 新寫入：在 feature hook 的 `onSuccess` 呼叫 `invalidateResources()`，只描述後端改了什麼。
4. `apis/__tests__/resources.test.ts` 補一個案例，鎖住換算結果。

> 登入時 `queryClient.clear()`、收到 `AUTHZ_FORBIDDEN` 時重抓 profile 屬於 **重新同步**，
> 不是資源變更，不走依賴圖。

### 6.3 跨分頁失效

`queryClient` 是 `web-core/cache/AppQueryClient.ts` 的實例：繼承 TanStack 的 `QueryClient`，
並持有 `query-invalidate` 頻道（[09 §5](./09-state-and-storage.md) 的持有者規則）。
廣播的是 **換算後的失效目標**，不是來源變更，收到的分頁直接套用、不再廣播（避免迴圈）。

```ts
export class AppQueryClient extends QueryClient {
  start() { this.offChannel ??= this.channel.on('invalidate', (t) => this.applyInvalidation(t)); } // 不再廣播
  applyInvalidation(targets, { refetch }) { … } // 只在本分頁：invalidate 或 remove
  broadcastInvalidation(targets) {              // 本分頁 ＋ 其他分頁
    this.applyInvalidation(targets);
    if (!this.isRealtimeAvailable()) this.channel.post('invalidate', targets);
  }
  revalidateAll({ refetch }) { … }              // 推播中斷後整批重新驗證
}
```

收訊由 cache plugin 管理：`onInit` 呼叫 `start()`、`onDestroy` 呼叫 `stop()`。

在 A 分頁刪掉一個角色，B 分頁的列表立刻更新。

**有推播之後**：其他分頁、其他裝置、其他使用者都由伺服器推 `resource.changed`，各自用同一張依賴圖換算；
`broadcastInvalidation` 只在推播 **斷線** 時才經 BroadcastChannel 廣播，避免同一個分頁失效兩次。
見 [`11-realtime.md`](./11-realtime.md) §4。

---

## 7. 錯誤處理

### 7.1 後端錯誤信封 → `AppError`

```ts
// web-core/plugins/fetcher/api-adapter.ts
// { error: { code, message, details } } → AppError
export class AppError extends Error {
  constructor(
    readonly code: string, // 'AUTHZ_FORBIDDEN'
    readonly status: number,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(code);
  }
}
```

### 7.2 三種錯誤，三種處理

| 類型         | 判斷                                      | 處理                                         |
| ------------ | ----------------------------------------- | -------------------------------------------- |
| **欄位層級** | `status === 400` 且 `details.fields` 存在 | 呼叫端的表單 `setFieldError()`，不顯示 toast |
| **業務規則** | `status === 403/409` 且有已知 `code`      | toast 顯示已本地化訊息                       |
| **未預期**   | 其餘                                      | toast 通用訊息 ＋ 顯示 `requestId` 供回報    |
| **中止**     | `RequestAbortedError`                     | `timeout` → toast `error.timeout`；其餘不提示（§3.3） |
| **連線**     | `NetworkError`                            | toast `error.network`（§3.4）                |

```ts
// web-core/errors/useErrorMessage.ts
export function useErrorMessage() {
  const { t } = useTranslation();
  return useCallback(
    (error: unknown) => {
      if (isRequestAborted(error)) {
        return error.reason === AbortReason.TIMEOUT ? t("error.timeout") : t("error.aborted");
      }
      if (isNetworkError(error)) return t("error.network");
      if (!(error instanceof AppError)) return t("error.unknown");
      // 錯誤碼 → 語系鍵走對照表，不組字串（conventions/06-literal-strings.md §3.1）
      const key = getErrorMessageKey(error.code);
      const msg = key ? t(key) : undefined;
      return msg && msg !== key
        ? msg
        : t("error.unknown_with_id", { requestId: error.requestId ?? "-" }); // 不認得的碼或缺翻譯
    },
    [t],
  );
}
```

### 7.3 403 的特別處理

收到 `AUTHZ_FORBIDDEN` 代表 **UI 顯示的能力與後端實際授權不一致**——
通常是權限剛被改掉。全域處理：

```ts
// web-core/shell/GlobalProvider.tsx（mutation 與 query 都監看）
queryClient.getMutationCache().subscribe((event) => {
  // 只看「這次變成錯誤」：observer 增減也會發事件，而 state.error 仍在，只看它會重複提示
  if (event.type === "updated" && event.action.type === "error") onError(event.action.error);
});
queryClient.getQueryCache().subscribe(/* 同上 */);

function onError(error: unknown) {
  if (!isForbidden(error)) return;
  if (Date.now() - lastHandledAt < 2_000) return; // 一個頁面好幾個 query 同時 403 → 只處理一次
  toast.warning(t("error.permission_changed"));
  queryClient.invalidateQueries({ queryKey: [AUTH_PROFILE_QUERY_KEY] }); // 立刻重新水合
}
```

**後端是權威，UI 發現不一致就立刻自我修正。**

---

## 8. 權限集合的水合

```ts
// features/auth/hooks/useSyncPermissions.ts
export function useSyncPermissions() {
  const setPermissions = usePermissionStore((s) => s.setPermissions);
  const { data } = useQuery({
    ...getAuthProfileQueryOptions(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    enabled: sessionStore.hasSession(),
  });

  useEffect(() => {
    if (data) setPermissions(data.permissions);
  }, [data, setPermissions]);
}
```

掛在 `app/App.tsx`，整個 app 只有一個實例。

**為什麼權限同時存在 Query 與 store**：

- Query 負責 **取得與新鮮度**（refetch 策略、去重、跨分頁）
- store 負責 **同步讀取**（`can(key)` 必須是同步的，`useQuery` 不是）

`useEffect` 是兩者之間的橋。

---

## 9. 反提權的前端實作

```ts
// features/role/hooks/useGrantablePermissions.ts
export function useGrantablePermissions() {
  const { permissions: mine } = usePermission();
  const { data: catalog } = useQuery(getPermissionListQueryOptions());

  return useMemo(() => {
    if (!catalog) return { grantable: [], blocked: [] };
    return {
      grantable: catalog.items.filter((p) => mine.has(p.key)),
      blocked: catalog.items.filter((p) => !mine.has(p.key)),
    };
  }, [catalog, mine]);
}
```

`blocked` 的項目在挑選器裡顯示為 disabled ＋ tooltip
「你未持有此權限，因此無法授予」，**不是隱藏**——隱藏會讓管理員以為系統沒有
這個權限，disabled ＋ 說明才能讓他知道要去找誰。

再次強調：這只是體驗。真正的防線是後端的 `AUTHZ_ESCALATION` 檢查。

---

## 10. Mock（MSW）

```
mocks/
├── browser.ts        dev 用 worker
├── server.ts         測試用 node server
├── config.ts
├── handlers/
│   ├── index.ts
│   ├── auth.ts
│   ├── user.ts
│   ├── role.ts
│   └── permission.ts
└── resources/        faker 產生的資料工廠（固定種子，可重現）
    ├── user.ts
    └── role.ts
```

- `VITE_ENABLE_MOCK=true pnpm dev:backstage` → 完全不需要後端即可開發前端
- Service Worker 腳本（`mockServiceWorker.js`）**不 commit、也不放 `public/`**：`vite.config.ts` 的
  `mockServiceWorker()` 外掛直接取已安裝的 `msw` 套件裡那一份，只在 `VITE_ENABLE_MOCK=true` 時提供
  （dev 由 middleware 回應、`vite build` 才輸出到 dist）。版本永遠與 `msw` 一致，正式產物也不會帶著它
- 登入交給 SSO（apps/platform），mock 模式不跳過去：`main.tsx` 啟動 worker 後呼叫
  `sessionStore.presumeSession()`，一律視為已登入，由 MSW 回應 `/auth/refresh` 與 `/auth/profile`
  （權限集合見 `mocks/config.ts`）。登出後會停在登入頁（按「登入」才會去真的 SSO）；重新整理就又登入。
  要看未登入的畫面請用元件測試，不要用 mock 模式
- 測試直接共用同一批 handler，個別 case 用 `server.use(...)` 覆寫
- handler 必須實作 **權限行為**：mock 的 `GET /auth/profile` 要能依測試情境回
  不同的權限集合，這樣才測得到 gating

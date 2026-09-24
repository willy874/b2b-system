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
core/client (HttpContext + 攔截器鏈)     ← 認證、續期、重試、錯誤轉換
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

---

## 3. `fetcher.ts`

```ts
// apis/role/get-role-list/fetcher.ts
import { Configuration, RolesApi } from "@/shared/api-sdk";
import type { ListRolesRequest, RoleListResponse } from "@/shared/api-sdk";
import { defineAuthFetcher, type HttpRequestDTO } from "@/core/client/http";

export const fetchRoleListQuery = defineAuthFetcher<
  HttpRequestDTO<ListRolesRequest>,
  RoleListResponse
>(async (_httpContext, fetcherContext, request) => {
  const api = new RolesApi(new Configuration(fetcherContext.initialConfig()));
  return api.listRoles(request.params);
});
```

### 3.1 `defineAuthFetcher` vs `defineBaseFetcher`

|                     | 掛上的攔截器                                | 用於                                      |
| ------------------- | ------------------------------------------- | ----------------------------------------- |
| `defineBaseFetcher` | retry、錯誤轉換                             | `/auth/login`、`/auth/refresh`、`/health` |
| `defineAuthFetcher` | 上述 ＋ `ensureAccessToken` ＋ 401 續期重放 | 其餘全部                                  |

用錯會造成死結：登入端點若用 `defineAuthFetcher`，它會先嘗試取得 access token
（還沒有），觸發續期（沒有 refresh token），失敗 → 登入永遠打不出去。

### 3.2 `HttpRequestDTO`

```ts
export interface HttpRequestDTO<P = unknown> {
  params: P;
  signal?: AbortSignal; // ★ TanStack Query 會傳入，用於取消
  headers?: Headers;
  // …其餘 RequestInit 欄位
}
```

`signal` 必須一路傳到 `fetch`，否則使用者快速切換篩選時，舊請求不會被取消，
可能造成「後回來的舊回應覆蓋新回應」。

---

## 4. `query.ts`

```ts
// apis/role/get-role-list/query.ts
import { keepPreviousData, queryOptions, infiniteQueryOptions } from "@tanstack/react-query";
import { fetchRoleListQuery } from "./fetcher";

export const ROLE_LIST_QUERY_KEY = "ROLE_LIST_QUERY_KEY";

const getRoleListQueryKeys = (p: ListRolesRequest) =>
  [ROLE_LIST_QUERY_KEY, p.offset, p.limit, p.keyword, p.sortBy, p.sortOrder] as const;

export const getRoleListQueryOptions = (options: HttpRequestDTO<ListRolesRequest>) =>
  queryOptions({
    queryKey: getRoleListQueryKeys(options.params),
    placeholderData: keepPreviousData, // 換頁時不閃空白
    queryFn: ({ queryKey, signal }) => {
      const [, offset, limit, keyword, sortBy, sortOrder] = queryKey;
      return fetchRoleListQuery({ signal, params: { offset, limit, keyword, sortBy, sortOrder } });
    },
  });

// 型別化的 query key 註冊（讓失效工具能推導）
declare module "@/core/cache/queryClient" {
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

`core/cache/queryClient.tsx`：

```ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30 秒內視為新鮮，不重取
      gcTime: 5 * 60_000,
      retry: false, // 重試交給 plugins/fetcher/retry.ts（它懂哪些該重試）
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
| `core/cache/resourceGraph.ts`     | 通用引擎：來源變更 → 失效目標（不認識任何業務 key）                  |
| `apis/resources.ts`               | 本專案的依賴宣告：每個資源有哪些 query、由哪些來源衍生               |
| `core/cache/broadcastInvalidate.ts` | 套用失效目標並跨分頁廣播（§6.3）                                    |

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
③ derivesFromAnyChange（稽核列表）
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
| `profile`：`AUTH_PROFILE`                                                      | `user` 更新（自己）、`userRole`（自己）、`role` 更新／刪除與 `rolePermission`（自己持有的角色） |
| `auditLog`：`AUDIT_LOG_LIST` ／ `AUDIT_LOG_DETAIL`                              | **任何寫入**（只影響列表；既有紀錄不可變）                                            |
| `permission`：`PERMISSION_LIST`                                                | 無（一個部署版本內不變）                                                              |

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
| 修改自己的 profile / 偏好 | `user` update（自己的 id），`refs.role` = 自己的角色（`selfUpdated()`）   |

「自己」的判斷讀 profile 快取；沒有快取時一律視為是（profile 只有一個 query，寧可多抓一次）。

#### 新增一支 query 或一種寫入

1. 新 query：把 key 放進 `apis/resources.ts` 對應資源的 `collection` 或 `entity`
   （`entity` 的 key 第二個元素必須是 id）。
2. 新的衍生關係：在 **被影響的資源** 上加 `derivesFrom`，並註解「為什麼」。
3. 新寫入：在 feature hook 的 `onSuccess` 呼叫 `invalidateResources()`，只描述後端改了什麼。
4. `apis/__tests__/resources.test.ts` 補一個案例，鎖住換算結果。

> 登入時 `queryClient.clear()`、收到 `AUTHZ_FORBIDDEN` 時重抓 profile 屬於 **重新同步**，
> 不是資源變更，不走依賴圖。

### 6.3 跨分頁失效

`core/cache/broadcastInvalidate.ts`：廣播的是 **換算後的失效目標**，不是來源變更，
收到的分頁直接套用、不再廣播（避免迴圈）。

```ts
export function broadcastInvalidate(targets: readonly InvalidationTarget[]) {
  apply(targets); // invalidate 或 remove
  channel?.postMessage({ targets });
}

channel.onmessage = (e) => apply(e.data.targets); // 不再廣播
```

在 A 分頁刪掉一個角色，B 分頁的列表立刻更新。

---

## 7. 錯誤處理

### 7.1 後端錯誤信封 → `AppError`

```ts
// plugins/fetcher/api-adapter.ts
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

```ts
// core/errors/useErrorMessage.ts
export function useErrorMessage() {
  const { t } = useTranslation();
  return useCallback(
    (error: unknown) => {
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
// app/GlobalProvider.tsx
queryClient.getMutationCache().subscribe((event) => {
  const error = event.mutation?.state.error;
  if (error instanceof AppError && error.code === "AUTHZ_FORBIDDEN") {
    toast.warning(t("error.permission_changed"));
    queryClient.invalidateQueries({ queryKey: [AUTH_PROFILE_QUERY_KEY] }); // 立刻重新水合
  }
});
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

- `VITE_ENABLE_MOCK=true pnpm dev:web` → 完全不需要後端即可開發前端
- 測試直接共用同一批 handler，個別 case 用 `server.use(...)` 覆寫
- handler 必須實作 **權限行為**：mock 的 `GET /auth/profile` 要能依測試情境回
  不同的權限集合，這樣才測得到 gating

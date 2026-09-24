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
Access Token   → 只存在 SessionStore 的閉包變數裡
                 重新整理頁面 = 消失 = 必須用 refresh token 重新取得
Refresh Token  → httpOnly cookie，JavaScript 讀不到
```

**沒有任何 token 進 `localStorage` 或 `sessionStorage`。** 這是對 XSS 的基本
防線：即使有腳本注入，也拿不走可長期使用的憑證。

代價：每次重新整理都要多一次 `POST /auth/refresh`（約 50 ms）。可接受。

---

## 5. 跨分頁同步

三個獨立的 `BroadcastChannel`：

| 通道                  | 用途                             | 位置                             |
| --------------------- | -------------------------------- | -------------------------------- |
| `ge:token`            | Token 續期協調（單飛、結果廣播） | `core/auth/SessionStore`         |
| `ge:query-invalidate` | Query 失效廣播                   | `core/cache/broadcastInvalidate` |
| `ge:session`          | 登出廣播（一處登出，全部登出）   | `core/auth/SessionStore`         |

### 5.1 Token 續期的單飛（最重要的一個）

Refresh token 是 **輪替** 的：用過一次就作廢，後端會換發新的。如果兩個分頁同時
拿同一個舊 token 去續期，第二個會被判定為「重用攻擊」，**整條 token 家族被撤銷，
使用者被登出**。

```
分頁 A 需要續期
  ├─ 檢查本地 in-flight promise → 有則共用
  ├─ 廣播 { type: 'refresh-start' }
  ├─ 實際打 POST /auth/refresh
  └─ 廣播 { type: 'refresh-done', accessToken, expiresAt }

分頁 B 需要續期
  ├─ 已收到 'refresh-start' 且在 3 秒內 → 等待 'refresh-done'
  ├─ 收到 → 直接採用，不打 API
  ├─ 收到 'refresh-failed' → 不再等：session 已結束就放棄，否則自己打
  └─ 逾時未收到（A 分頁可能被關了）→ 自己打
```

**續期失敗不一定是 session 結束。** 只有伺服器明確拒絕（401、`AUTH_REFRESH_*`、
`AUTH_ACCOUNT_DISABLED`，即 `isSessionRejected()`）才結束 session；網路錯誤、5xx、
`429 RATE_LIMITED`、逾時都是暫時性的，保留 session，錯誤照常回報給這次請求，
下一個請求會再試一次續期（冪等請求由 `retry.ts` 自動重試）。否則一次網路抖動
就會把使用者登出。

**逾時的必要性**：廣播「我要續期了」之後如果那個分頁被關掉，其他分頁不能永遠
等下去。3 秒是一個「正常續期一定完成、異常時使用者也還沒察覺」的值。

另一個細節：**只有在「確定有其他分頁存在」時才付這個等待成本**。
`SessionStore` 會在啟動時廣播一次 ping，收到回應才記下 `peerSeen = true`。
單一分頁的情況（絕大多數）完全不等待。

### 5.2 登出廣播

```ts
channel.postMessage({ type: "session-ended", reason });
// 其他分頁：clear permission store → queryClient.clear() → navigate('/auth/login')
```

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
| 每個分頁各自續期 token                   | `BroadcastChannel` 單飛                     |

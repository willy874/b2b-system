# 詳情頁的「載入中／查詢失敗／已刪除」骨架逐頁複製

## 現況

以路由開啟的詳情對話框（或面板）都自己寫同一套查詢狀態的處理（路徑相對 `apps/backstage/src/features/`）：

```tsx
const close = () => void navigate({ to: XxxListRoute.to, search });
<Dialog open onOpenChange={(open) => !open && close()} title={query.data?.name ?? t('xxx.detail.title')} ...>
  {query.isPending && <Skeleton height={160} />}
  {query.isError && (
    <QueryError
      error={query.error}
      onRetry={isNotFound(query.error) ? undefined : () => void query.refetch()}
      action={<Button onClick={close}>{t('xxx.detail.backToList')}</Button>}
    />
  )}
  {query.data && ...}
</Dialog>
```

| 位置 | `close` | `isNotFound` 不重試 |
| --- | --- | --- |
| `webhook/pages/WebhookDetail/page.tsx` | `:26` | `:46` |
| `group/pages/GroupDetail/page.tsx` | `:41` | `:61` |
| `user/pages/UserDetail/page.tsx` | `:40` | `:61` |
| `role/pages/RoleDetail/page.tsx` | `:55` | `:115` |
| `service-account/pages/ServiceAccountDetail/page.tsx` | `:32` | `:52` |
| `announcement/pages/AnnouncementDetail/page.tsx` | `:27-28` | `:47` |
| `announcement/pages/AnnouncementMessage/page.tsx` | — | `:39` |
| `approval/pages/ApprovalDetail/components/ApprovalDetailView.tsx` | 由 `onBack` 傳入 | `:137` |
| `organization/pages/Organization/components/OrgUnitDetailPanel.tsx` | 面板，非對話框 | `:45` |

apps/platform 也有同樣的寫法：`apps/platform/src/features/tenant/pages/TenantDetail/page.tsx:36-54`（`PageSkeleton` ＋ `QueryError` ＋ `isNotFound`）。

每份的差別只有骨架高度（160 或 200）、testid 前綴與「返回」按鈕的文字鍵。

## 影響

- 「已刪除的資源不提供重試」這條規則靠每頁記得寫 `isNotFound(...) ? undefined : refetch`；新詳情頁漏寫時，深層連結（站內通知、稽核）指到已刪除的資源會出現無效的「重試」。
- 之後要統一調整（例：403 也不重試、錯誤時標題改成「找不到」、骨架換成與內容相近的形狀）要改 10 處。

嚴重度低：開發體驗與程式整潔，目前各頁行為一致且正確。

## 修正方式

兩個 app 都用到，放 `packages/web-core/src/components/`（與 `QueryError`、`PageSkeleton` 同處），分兩步：

1. **`QueryBoundary`**（名稱可再議）：收 `query`（`UseQueryResult`）、`children: (data) => ReactNode`、`skeleton`（預設 `<Skeleton height={160} />`）、
   `backAction`（`{ label, onClick }` 或 `ReactNode`）與 `data-testid` 前綴。內部處理 pending／error／data 三態，`isNotFound` 時不給 `onRetry`。
   web-core 不認識 feature 與 app 的路由，返回的導向由呼叫端傳入。
2. 逐頁替換上表 10 處；`Dialog` 的外框（`open`、`onOpenChange`、`title`、`footer`）維持在各頁，不包進共用元件
   （各頁的 footer、`size` 與未儲存守衛不同，包進去參數會比省下的程式還多）。

## 驗證方式

- `packages/web-core/src/components/__tests__/` 補 `QueryBoundary` 的測試：pending 顯示骨架、一般錯誤有「重試」、404 沒有「重試」但有返回、成功時渲染 children。
- 各詳情頁既有的頁面測試（含「資源已刪除」的案例）與 E2E 通過；testid 維持原名（`<prefix>-error`、`<prefix>-back`），E2E 不必改。
- `grep -rn "isNotFound(" apps/*/src --include='*.tsx'` 只剩非詳情頁的用法。

（2026-10-10 backstage 各功能的優化分析發現。）

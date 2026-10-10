# 部門成員：移除最後一頁唯一的成員後卡在空頁，分頁也消失

## 現況

`apps/backstage/src/features/organization/pages/Organization/components/OrgUnitMemberSection.tsx`：

- 46 行 `const [offset, setOffset] = useState(0)`，換頁時改它；只有切換「含下層部門」時（95–98 行）歸零。
- 67 行 `total = members.data?.pagination.total ?? 0`。
- 197–205 行：分頁只在 `total > MEMBER_PAGE_SIZE`（50）時出現。
- 移除成員（74–85 行）成功後查詢重抓，`offset` 不變。

重現：部門有 51 位成員 → 換到第 2 頁（`offset` 50，只有 1 位）→ 移除他 → 重抓的結果是 `items: []`、`total: 50`。
清單顯示「無」（191–195 行），標題是「成員（50）」，而 `total > 50` 不成立，分頁消失，沒有辦法回到第 1 頁；
要重新選一次部門（面板以 `unitId` 為 key 重建）才恢復。

`total` 從 101 降到 100、停在第 3 頁時同樣是空頁，只是分頁還在、可以自己點回去。

## 影響

管理者以為部門已經沒有成員（標題又說有 50 位），而且畫面上沒有可以操作的出路。只發生在最後一頁只剩一位、剛好被移除時。

嚴重度低：資料正確、重新選部門即可恢復，是分頁狀態沒有跟著資料修正。

## 修正方式

在元件裡依查詢結果把 `offset` 夾回範圍內：

```ts
useEffect(() => {
  if (members.data && offset > 0 && offset >= members.data.pagination.total) {
    setOffset(Math.max(0, Math.floor((members.data.pagination.total - 1) / MEMBER_PAGE_SIZE) * MEMBER_PAGE_SIZE));
  }
}, [members.data, offset]);
```

或在移除成功的回呼裡判斷「這一頁只剩這一位」就先退一頁。若 `RichTable` 或 `Pagination` 已有同樣的夾範圍邏輯，抽成共用的 hook
（例如 `web-core` 的 `useClampedOffset(total, offset, limit, setOffset)`），群組成員加上分頁時（見 [`list-silent-truncation.md`](./list-silent-truncation.md)）一併使用。

## 驗證方式

`OrgUnitMemberSection` 的元件測試：msw 先回 `total: 51`，換到第 2 頁 → 移除那一位，msw 改回 `total: 50`、`offset=50` 回空陣列 →
預期下一個請求帶 `offset=0`，畫面列出成員而不是「無」。

（2026-10-10 backstage 各功能的優化分析發現。）

# 換頁不回到頂端、返回列表時捲動位置不見

## 現況

- `apps/backstage/src/app/plugin.ts` 第 23–38 行的 `createRouter` 沒有設 `scrollRestoration`，也沒有 `scrollToTopSelectors`。
- 實際捲動的是外框的 `<main>`：`packages/web-core/src/layout/DashboardShell.module.css` 第 109–116 行的 `.content`（`overflow: auto`），`DashboardShell.tsx` 第 167 行。它由 `app/Layout.tsx` 的 `DashboardLayout` 包住所有頁面，換頁時同一個元素一直存在。
- TanStack Router（`@tanstack/router-core` 1.171 的 `scroll-restoration.ts`）：沒開 `scrollRestoration` 時只在換頁後把 `window` 捲回頂端（`scrollToTopSelectors` 預設 `['window']`）；自訂的捲動容器要列進 `scrollToTopSelectors` 才會歸零，要開 `scrollRestoration` 才會記住並還原各容器的位置（以 `data-scroll-restoration-id` 或 DOM 路徑辨識）。
- `DashboardShell` 自己只在換頁時收起抽屜（第 84–88 行），沒有處理捲動；repo 裡也沒有其他 `scrollTo`／`data-scroll-restoration-id`。

結果：

1. 在捲到下方的頁面點進另一頁，`.content` 的 `scrollTop` 沿用，新頁面可能從中間開始顯示。
2. 從整頁的審批詳情（`features/approval/routes/pages.ts` 第 30–37 行，網址帶著列表條件）按返回，篩選還原了，捲動位置沒有。

## 影響

換頁後看不到頁首、要自己捲回去；長列表點進詳情再返回要重新找位置。

嚴重度低：導覽體驗。

## 修正方式

在 `createAppRouter` 加：

```ts
scrollRestoration: true,
scrollToTopSelectors: ['window', () => document.querySelector('[data-scroll-restoration-id="app-content"]')],
```

並在 `DashboardShell` 的 `<main>` 加 `data-scroll-restoration-id="app-content"`（在 web-core，apps/platform 的 router 也一起設）。表格自己捲動（`Table` 的 `data-scrollable`／`fillHeight`）的列表若也要還原，給該容器穩定的 `data-scroll-restoration-id`。

## 驗證方式

- 瀏覽器：在長頁面捲到下方後點側欄換頁，新頁從頂端開始；審批列表捲到下方點進詳情、按返回，回到原位置。
- 可補一個 E2E 斷言 `main` 的 `scrollTop`。

（2026-10-10 backstage 各功能的優化分析發現。）

/** 外框實際捲動的元素（`DashboardShell` 的 `<main>`）：捲動還原以它辨識。 */
export const APP_CONTENT_SCROLL_ID = 'app-content';

const APP_CONTENT_SELECTOR = `[data-scroll-restoration-id="${APP_CONTENT_SCROLL_ID}"]`;

/**
 * 兩個 app 的 `createRouter` 共用的捲動設定：換頁回到頂端、返回時還原原本的位置。
 * 頁面不是捲 `window` 而是捲外框的 `<main>`：要列進 `scrollToTopSelectors` 才會歸零，
 * 開 `scrollRestoration` 才會記住並還原（以 `data-scroll-restoration-id` 辨識）。
 */
export const scrollRestorationOptions = {
  scrollRestoration: true,
  scrollToTopSelectors: ['window', () => document.querySelector(APP_CONTENT_SELECTOR)],
} satisfies {
  scrollRestoration: boolean;
  scrollToTopSelectors: Array<string | (() => Element | null | undefined)>;
};

import { createContext, use } from 'react';

/**
 * 設計系統元件自己的文案（報讀器用的名稱、預設提示）。
 *
 * `components/` 不能依賴語系，所以預設值寫死成繁中；app 以 `ComponentLabelsContext` 傳入目前語系的 `t()`，
 * 元件在呼叫端沒有明確傳入時改用 context 的值。這樣英文介面不會漏出中文預設文案，
 * 也不必每個呼叫端各自傳（docs/issues/04-user-experience.md UX-26、UX-36）。
 */
export interface ComponentLabels {
  /** `Field` 必填標記給報讀器的文字（星號本身是 aria-hidden）。 */
  required: string;
  selectSearch: string;
  selectNoMatch: string;
  selectLoading: string;
  selectAll: string;
  toastClose: string;
  paginationNav: string;
  paginationPageSize: string;
  paginationFirst: string;
  paginationLast: string;
  paginationPrevious: string;
  paginationNext: string;
  /** 跳頁輸入框的名稱。 */
  paginationPage: string;
}

export const DEFAULT_COMPONENT_LABELS: ComponentLabels = {
  required: '必填',
  selectSearch: '搜尋…',
  selectNoMatch: '沒有符合的項目',
  selectLoading: '載入中…',
  selectAll: '全選',
  toastClose: '關閉',
  paginationNav: '分頁',
  paginationPageSize: '每頁筆數',
  paginationFirst: '第一頁',
  paginationLast: '最後一頁',
  paginationPrevious: '上一頁',
  paginationNext: '下一頁',
  paginationPage: '頁碼',
};

export const ComponentLabelsContext = createContext<ComponentLabels>(DEFAULT_COMPONENT_LABELS);

/** 元件內部取得目前語系的預設文案。 */
export function useComponentLabels(): ComponentLabels {
  return use(ComponentLabelsContext);
}

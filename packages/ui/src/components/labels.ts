import { createContext, use } from 'react';

/** `TreeEditor` 工具列與空狀態的文案（工具列只顯示圖示，這些字就是按鈕的名稱與提示）。 */
export interface TreeEditorTextLabels {
  addRoot: string;
  addChild: string;
  deleteSelection: string;
  autoLayout: string;
  fitView: string;
  zoomIn: string;
  zoomOut: string;
  undo: string;
  redo: string;
  /** 工具列放不下時，收起其餘按鈕的下拉按鈕。 */
  more: string;
  /** 沒有任何節點時的標題。 */
  empty: string;
}

/** `RichTextEditor` 工具列、連結列與字數的文案（格式按鈕只顯示圖示，這些字就是按鈕的名稱與提示）。 */
export interface RichTextEditorTextLabels {
  bold: string;
  italic: string;
  underline: string;
  strike: string;
  code: string;
  heading2: string;
  heading3: string;
  bulletList: string;
  orderedList: string;
  blockquote: string;
  codeBlock: string;
  horizontalRule: string;
  /** 工具列的連結按鈕，也是連結列（`role="group"`）的名稱。 */
  link: string;
  undo: string;
  redo: string;
  /** 工具列放不下時，收起其餘按鈕的下拉按鈕。 */
  more: string;
  /** 連結列的網址輸入框。 */
  linkUrl: string;
  linkApply: string;
  linkRemove: string;
  linkCancel: string;
  /** 網址不能用（只接受 http、https、mailto 與站內路徑）。 */
  linkInvalid: string;
  /** 設了 `maxLength` 時編輯區下方的字數，例如「12 / 500」。 */
  characterCount: (count: number, max: number) => string;
}

/**
 * 設計系統元件自己的文案（報讀器用的名稱、預設提示）。
 *
 * `components/` 不能依賴語系，所以預設值寫死成繁中；app 以 `ComponentLabelsContext` 傳入目前語系的 `t()`，
 * 元件在呼叫端沒有明確傳入時改用 context 的值。這樣英文介面不會漏出中文預設文案，
 * 也不必每個呼叫端各自傳。
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
  /** 目前的介面語系（BCP 47，例：`en-US`）：日曆的月份標題與星期依它格式化。 */
  locale: string;
  /** `Spinner` 沒有傳 `label` 時的名稱（載入中的 `Button` 也用它）。 */
  loading: string;
  calendarPreviousMonth: string;
  calendarNextMonth: string;
  /** `DatePicker`／`DateRangePicker` 的清除鈕。 */
  datePickerClear: string;
  /** `DatePicker`／`DateRangePicker` 的觸發鈕（沒有 `aria-label`、也不在 `Field` 裡時）。 */
  datePickerOpen: string;
  treeEditor: TreeEditorTextLabels;
  richTextEditor: RichTextEditorTextLabels;
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
  locale: 'zh-TW',
  loading: '載入中',
  calendarPreviousMonth: '上個月',
  calendarNextMonth: '下個月',
  datePickerClear: '清除',
  datePickerOpen: '開啟日曆',
  treeEditor: {
    addRoot: '新增根節點',
    addChild: '新增子節點',
    deleteSelection: '刪除選取',
    autoLayout: '自動排版',
    fitView: '顯示全部',
    zoomIn: '放大',
    zoomOut: '縮小',
    undo: '復原',
    redo: '重做',
    more: '更多',
    empty: '還沒有任何節點',
  },
  richTextEditor: {
    bold: '粗體',
    italic: '斜體',
    underline: '底線',
    strike: '刪除線',
    code: '行內程式碼',
    heading2: '標題',
    heading3: '小標題',
    bulletList: '項目清單',
    orderedList: '編號清單',
    blockquote: '引言',
    codeBlock: '程式碼區塊',
    horizontalRule: '分隔線',
    link: '連結',
    undo: '復原',
    redo: '重做',
    more: '更多',
    linkUrl: '連結網址',
    linkApply: '套用',
    linkRemove: '移除連結',
    linkCancel: '取消',
    linkInvalid: '請輸入 http、https 或 mailto 開頭的網址',
    characterCount: (count, max) => `${count} / ${max}`,
  },
};

export const ComponentLabelsContext = createContext<ComponentLabels>(DEFAULT_COMPONENT_LABELS);

/** 元件內部取得目前語系的預設文案。 */
export function useComponentLabels(): ComponentLabels {
  return use(ComponentLabelsContext);
}

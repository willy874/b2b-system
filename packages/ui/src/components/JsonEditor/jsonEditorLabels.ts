import type { JsonViewerLabels } from '../JsonViewer';
import type { JsonContainerKind } from '../JsonViewer/jsonLines';

/* JsonEditor 的文案：可覆寫的鍵與繁中的預設值。 */

export interface JsonEditorLabels extends JsonViewerLabels {
  expandAll?: string;
  collapseAll?: string;
  format?: string;
  compact?: string;
  undo?: string;
  redo?: string;
  /** 工具列放不下時，收起其餘按鈕的下拉按鈕。 */
  more?: string;
  /** 內容不是合法 JSON；後面接瀏覽器的錯誤訊息。 */
  parseError?: string;
  search?: string;
  searchPlaceholder?: string;
  previousMatch?: string;
  nextMatch?: string;
  closeSearch?: string;
  noMatch?: string;
  /** 搜尋結果的位置，例如「2 / 5」。 */
  matchCount?: (active: number, total: number) => string;
  /** 驗證錯誤清單的標題，例如「3 個驗證錯誤」。 */
  validationErrors?: (count: number) => string;
  /** 驗證錯誤清單裡根節點的名稱。 */
  rootPath?: string;
}

export const DEFAULT_JSON_EDITOR_LABELS = {
  expand: '展開',
  collapse: '收合',
  summary: (size: number, container: JsonContainerKind) =>
    container === 'array' ? `${size} 項` : `${size} 個欄位`,
  expandAll: '全部展開',
  collapseAll: '全部收合',
  format: '格式化',
  compact: '壓縮',
  undo: '復原',
  redo: '重做',
  more: '更多',
  parseError: '不是合法的 JSON',
  search: '搜尋',
  searchPlaceholder: '搜尋鍵名或值',
  previousMatch: '上一個',
  nextMatch: '下一個',
  closeSearch: '關閉搜尋',
  noMatch: '沒有符合的結果',
  matchCount: (active: number, total: number) => `${active} / ${total}`,
  validationErrors: (count: number) => `${count} 個驗證錯誤`,
  rootPath: '（根）',
} satisfies Required<JsonEditorLabels>;

/** 補上預設之後的文案。 */
export type ResolvedJsonEditorLabels = typeof DEFAULT_JSON_EDITOR_LABELS;

import { cn } from '@b2b-system/web-shared/utils';
import { lazy, Suspense } from 'react';
import type { CSSProperties } from 'react';

import { useComponentLabels } from '../labels';
// 只取型別：值的 import 會讓 Tiptap 跟著這個檔案進到呼叫端的 chunk
import type * as RichTextEditorModule from '../RichTextEditor/RichTextEditor';
import type { RichTextEditorProps } from '../RichTextEditor/RichTextEditor';
import { Skeleton } from '../Skeleton';

import styles from './LazyRichTextEditor.module.css';

/** 編輯器本體（Tiptap ＋ ProseMirror，約 140 KB gzip）在獨立的 chunk；同一個 Promise 給 lazy 與預先載入共用。 */
let editorModule: Promise<typeof RichTextEditorModule> | undefined;
const loadEditor = () => (editorModule ??= import('../RichTextEditor/RichTextEditor'));

const RichTextEditor = lazy(() =>
  loadEditor().then((module) => ({ default: module.RichTextEditor })),
);

/**
 * 先開始下載編輯器（例：滑過「新增」「編輯」按鈕時），真的渲染時就不必等。可以直接當事件處理函式。
 * 重複呼叫只會下載一次。下載失敗不在這裡報錯：清掉快取，真的渲染時 lazy 再試一次，失敗才交給 error boundary。
 */
export function preloadRichTextEditor(): void {
  loadEditor().catch(() => {
    editorModule = undefined;
  });
}

export type LazyRichTextEditorProps = RichTextEditorProps;

/**
 * `RichTextEditor` 的延遲載入版本：props 完全相同。第一次渲染時才下載編輯器，期間顯示同樣大小的骨架
 * （工具列 ＋ `minHeight` 的編輯區），版面不跳動。頁面用它，而不是直接 import `RichTextEditor`
 * （docs/architecture/frontend/07-ui-system.md §3.16）。下載失敗時錯誤交給外層的 error boundary。
 */
export function LazyRichTextEditor(props: LazyRichTextEditorProps) {
  return (
    <Suspense fallback={<EditorPlaceholder {...props} />}>
      <RichTextEditor {...props} />
    </Suspense>
  );
}

/** 載入中：與編輯器相同的外框與高度。`data-testid` 固定是 `rich-text-editor-loading`（不沿用呼叫端的，測試不會把它當成編輯器）。 */
function EditorPlaceholder({
  readOnly,
  minHeight = '6rem',
  maxLength,
  className,
  style,
}: LazyRichTextEditorProps) {
  const labels = useComponentLabels();
  return (
    // `<output>`：隱含 role="status"，報讀器念出「載入中」
    <output
      className={cn(styles.root, className)}
      style={{ '--lazy-rich-text-min-height': toCssLength(minHeight), ...style } as CSSProperties}
      aria-busy="true"
      aria-label={labels.loading}
      data-testid="rich-text-editor-loading"
    >
      {!readOnly && (
        <div className={styles.toolbar}>
          <Skeleton width="60%" height={20} />
        </div>
      )}
      <div className={styles.content}>
        <Skeleton width="80%" />
        <Skeleton width="50%" />
      </div>
      {maxLength !== undefined && <div className={styles.footer} />}
    </output>
  );
}

/** 長度是數字時與 React 的 style 一樣視為 px。 */
function toCssLength(length: CSSProperties['minHeight']): string | undefined {
  return typeof length === 'number' ? `${length}px` : length;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import type { SlotAttributes, SlotResolver } from '../slots';
import { Tooltip } from '../Tooltip';
import { useVirtualRows } from '../VirtualList';
import type { JsonContainerKind, JsonLine, JsonPrimitiveKind } from './jsonLines';

import styles from './JsonViewer.module.css';

/** `className` / `style` / `data-testid` 落在捲動容器；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type JsonViewerSlot = 'lines' | 'line' | 'toggle';

export interface JsonViewerLabels {
  /** 展開鈕的無障礙名稱。 */
  expand?: string;
  /** 收合鈕的無障礙名稱。 */
  collapse?: string;
  /** 收合的物件／陣列後面的摘要，例如「3 個欄位」。 */
  summary?: (size: number, container: JsonContainerKind) => string;
  /** 收合的容器裡面有驗證錯誤時的提示。 */
  nestedError?: string;
}

/** 行的標記：這一行本身的驗證錯誤，或（收合時）裡面有錯誤。 */
export type JsonLineAnnotation = { errors: readonly string[] } | { nested: true };

/** JsonEditor 在同一套行渲染上替換鍵名、值，並在行尾加操作；JsonViewer 不傳。 */
export interface JsonTreeRenderers {
  /** 回傳 `undefined` 時用預設的鍵名。 */
  renderKey?: (line: JsonLine) => ReactNode;
  /** 只對 `value` 行呼叫；回傳 `undefined` 時用預設的值。 */
  renderValue?: (line: JsonLine & { type: 'value' }) => ReactNode;
  /** 行尾的操作（`close` 行不呼叫）。 */
  renderActions?: (line: JsonLine) => ReactNode;
}

/** 與 CSS 的 `.line` 高度（1.25rem）一致，捲動時不需修正位置。 */
const LINE_HEIGHT = 20;

export const JSON_PRIMITIVE_CLASS = {
  string: styles.string,
  number: styles.number,
  boolean: styles.boolean,
  null: styles.null,
  other: styles.null,
} as const satisfies Record<JsonPrimitiveKind, string | undefined>;

const BRACKETS = {
  object: ['{', '}'],
  array: ['[', ']'],
} as const satisfies Record<JsonContainerKind, readonly [string, string]>;

const defaultSummary = (size: number, container: JsonContainerKind) =>
  container === 'array' ? `${size} 項` : `${size} 個欄位`;

/** 把文字中符合 `query` 的部分（不分大小寫）包成 `<mark>`；沒有 query 時原樣回傳。 */
export function highlightText(text: string, query: string | undefined): ReactNode {
  const needle = query?.trim().toLowerCase();
  if (!needle) return text;
  const haystack = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className={styles.match}>
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
  }
  if (parts.length === 0) return text;
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

interface LineProps extends JsonTreeRenderers {
  line: JsonLine;
  index: number;
  /** 虛擬捲動時的列頂位置（px）；未虛擬化時為 `undefined`。 */
  start: number | undefined;
  measureElement: ((element: Element | null) => void) | undefined;
  onToggle: (path: string) => void;
  isActive: boolean;
  highlight: string | undefined;
  annotation: JsonLineAnnotation | undefined;
  expandLabel: string;
  collapseLabel: string;
  nestedErrorLabel: string;
  summary: (size: number, container: JsonContainerKind) => string;
  lineSlot: SlotAttributes;
  toggleSlot: SlotAttributes;
}

function Line({
  line,
  index,
  start,
  measureElement,
  onToggle,
  isActive,
  highlight,
  annotation,
  expandLabel,
  collapseLabel,
  nestedErrorLabel,
  summary,
  lineSlot,
  toggleSlot,
  renderKey,
  renderValue,
  renderActions,
}: LineProps) {
  const isToggleable = line.type === 'open' || (line.type === 'collapsed' && line.size > 0);
  const isExpanded = line.type === 'open';
  const style: CSSProperties = {
    ...lineSlot.style,
    paddingInlineStart: `${line.depth * 2}ch`,
    // 虛擬捲動：寬度不設 100%（長的行要能撐出水平捲動），由 CSS 的 min-width 保證至少和框一樣寬
    ...(start !== undefined && {
      position: 'absolute',
      top: 0,
      left: 0,
      transform: `translateY(${start}px)`,
    }),
  };

  let body: ReactNode;
  if (line.type === 'value') {
    body = renderValue?.(line) ?? (
      <span className={JSON_PRIMITIVE_CLASS[line.kind]}>{highlightText(line.text, highlight)}</span>
    );
  } else if (line.type === 'close') {
    body = <span className={styles.punctuation}>{BRACKETS[line.container][1]}</span>;
  } else if (line.type === 'open') {
    body = <span className={styles.punctuation}>{BRACKETS[line.container][0]}</span>;
  } else {
    const [open, close] = BRACKETS[line.container];
    body = (
      <>
        <span className={styles.punctuation}>
          {line.size > 0 ? `${open}…${close}` : `${open}${close}`}
        </span>
        {line.size > 0 && (
          <span className={styles.summary}>{summary(line.size, line.container)}</span>
        )}
      </>
    );
  }

  const keyNode =
    line.key === undefined
      ? undefined
      : // 與 svelte-jsoneditor 的 tree 模式一樣，鍵名不加引號
        (renderKey?.(line) ?? (
          <span className={styles.key}>{highlightText(line.key, highlight)}</span>
        ));
  const actions = line.type === 'close' ? undefined : renderActions?.(line);
  // 裡面有錯誤的標記只在收合時顯示；展開時錯誤就在底下的行上
  const errors = annotation && 'errors' in annotation ? annotation.errors : undefined;
  const hasNestedError = annotation && 'nested' in annotation && line.type === 'collapsed';

  return (
    <div
      ref={measureElement}
      data-index={index}
      className={cn(styles.line, lineSlot.className)}
      style={style}
      data-testid={lineSlot['data-testid']}
      data-value={line.path}
      data-active={isActive || undefined}
      data-invalid={errors ? true : undefined}
    >
      {isToggleable ? (
        <button
          type="button"
          aria-label={isExpanded ? collapseLabel : expandLabel}
          aria-expanded={isExpanded}
          onClick={() => onToggle(line.path)}
          className={cn(styles.toggle, toggleSlot.className)}
          style={toggleSlot.style}
          data-testid={toggleSlot['data-testid']}
        >
          <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={14} />
        </button>
      ) : (
        <span className={styles.toggleSpacer} aria-hidden />
      )}
      {keyNode !== undefined && (
        <>
          {keyNode}
          <span className={styles.punctuation}>: </span>
        </>
      )}
      {body}
      {line.comma && <span className={styles.punctuation}>,</span>}
      {(errors || hasNestedError) && (
        <Tooltip content={errors ? errors.join('\n') : nestedErrorLabel}>
          <span
            className={styles.marker}
            data-nested={hasNestedError || undefined}
            data-testid="json-viewer-marker"
          >
            {/* 提示框只給滑鼠；報讀器讀圖示的名稱，鍵盤使用者從驗證錯誤清單取得同樣的內容 */}
            <Icon
              name="warning"
              size={14}
              aria-label={errors ? errors.join('；') : nestedErrorLabel}
            />
          </span>
        </Tooltip>
      )}
      {actions !== undefined && <span className={styles.actions}>{actions}</span>}
    </div>
  );
}

export interface JsonTreeProps extends JsonTreeRenderers {
  ref?: Ref<HTMLElement>;
  lines: JsonLine[];
  onToggle: (path: string) => void;
  maxHeight: CSSProperties['maxHeight'];
  virtualThreshold: number | undefined;
  labels: JsonViewerLabels | undefined;
  slot: SlotResolver<JsonViewerSlot>;
  /**
   * 目前的焦點行（搜尋結果、點選的驗證錯誤）：該行加底色，並捲進可視範圍。
   * 每次跳轉傳一個新物件——同一行再跳一次也會重新捲過去。
   */
  activeTarget?: { path: string };
  /** 鍵名與值中符合的文字加上底色。 */
  highlight?: string;
  /** 以行的路徑字串為鍵。 */
  annotations?: ReadonlyMap<string, JsonLineAnnotation>;
  className?: string;
  style?: CSSProperties;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  'aria-label'?: string;
  'data-testid'?: string;
}

/**
 * JsonViewer 與 JsonEditor 共用的行渲染：捲動框 ＋ 逐行（超過門檻時虛擬捲動）。
 * 不從 index 匯出。
 */
export function JsonTree({
  ref,
  lines,
  onToggle,
  maxHeight,
  virtualThreshold,
  labels,
  slot,
  activeTarget,
  highlight,
  annotations,
  className,
  style,
  renderKey,
  renderValue,
  renderActions,
  ...rest
}: JsonTreeProps) {
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const composedRef = useCallback(
    (element: HTMLElement | null) => {
      setScrollElement(element);
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );

  const { rows, containerStyle, measureElement, scrollToIndex } = useVirtualRows({
    count: lines.length,
    scrollElement,
    estimateSize: LINE_HEIGHT,
    threshold: virtualThreshold,
  });

  // 每個 activeTarget 只捲一次：之後編輯造成 lines 改變時不會又被拉回去。
  // 目標行在上層展開後才出現，所以要等到找得到那一行才算捲過。
  const scrolledTarget = useRef<{ path: string }>(undefined);
  useEffect(() => {
    if (!activeTarget || scrolledTarget.current === activeTarget) return;
    const index = lines.findIndex(
      (line) => line.path === activeTarget.path && line.type !== 'close',
    );
    if (index === -1) return;
    scrolledTarget.current = activeTarget;
    scrollToIndex(index, 'center');
  }, [activeTarget, lines, scrollToIndex]);

  const linesSlot = slot('lines', styles.lines);
  const lineSlot = slot('line', undefined, { testId: 'json-viewer-item' });
  const toggleSlot = slot('toggle', undefined, { testId: 'json-viewer-toggle' });

  return (
    // 帶 aria-label 的 <section> 是 region；可捲動的容器瀏覽器本身就能用鍵盤聚焦捲動
    <section
      ref={composedRef}
      className={cn(styles.root, className)}
      style={{ maxHeight, ...style }}
      {...rest}
    >
      <div
        className={linesSlot.className}
        style={containerStyle ? { ...linesSlot.style, ...containerStyle } : linesSlot.style}
        data-testid={linesSlot['data-testid']}
      >
        {rows.map(({ index, start }) => {
          const line = lines[index] as JsonLine;
          return (
            <Line
              key={line.type === 'close' ? `${line.path}/close` : line.path}
              line={line}
              index={index}
              start={start}
              measureElement={measureElement}
              onToggle={onToggle}
              isActive={line.type !== 'close' && line.path === activeTarget?.path}
              highlight={highlight}
              annotation={line.type === 'close' ? undefined : annotations?.get(line.path)}
              expandLabel={labels?.expand ?? '展開'}
              collapseLabel={labels?.collapse ?? '收合'}
              nestedErrorLabel={labels?.nestedError ?? '內含驗證錯誤'}
              summary={labels?.summary ?? defaultSummary}
              lineSlot={lineSlot}
              toggleSlot={toggleSlot}
              renderKey={renderKey}
              renderValue={renderValue}
              renderActions={renderActions}
            />
          );
        })}
      </div>
    </section>
  );
}

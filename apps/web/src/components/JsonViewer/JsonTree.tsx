import { useCallback, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import type { SlotAttributes, SlotResolver } from '../slots';
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
}

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

interface LineProps extends JsonTreeRenderers {
  line: JsonLine;
  index: number;
  /** 虛擬捲動時的列頂位置（px）；未虛擬化時為 `undefined`。 */
  start: number | undefined;
  measureElement: ((element: Element | null) => void) | undefined;
  onToggle: (path: string) => void;
  expandLabel: string;
  collapseLabel: string;
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
  expandLabel,
  collapseLabel,
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
      <span className={JSON_PRIMITIVE_CLASS[line.kind]}>{line.text}</span>
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
        (renderKey?.(line) ?? <span className={styles.key}>{line.key}</span>);
  const actions = line.type === 'close' ? undefined : renderActions?.(line);

  return (
    <div
      ref={measureElement}
      data-index={index}
      className={cn(styles.line, lineSlot.className)}
      style={style}
      data-testid={lineSlot['data-testid']}
      data-value={line.path}
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

  const { rows, containerStyle, measureElement } = useVirtualRows({
    count: lines.length,
    scrollElement,
    estimateSize: LINE_HEIGHT,
    threshold: virtualThreshold,
  });

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
              expandLabel={labels?.expand ?? '展開'}
              collapseLabel={labels?.collapse ?? '收合'}
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

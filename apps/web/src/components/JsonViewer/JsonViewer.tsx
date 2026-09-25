import { useCallback, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import { createSlots } from '../slots';
import type { SlotAttributes, SlotOverrides } from '../slots';
import { useVirtualRows } from '../VirtualList';
import { toJsonLines } from './jsonLines';
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

export interface JsonViewerProps extends SlotOverrides<JsonViewerSlot> {
  /** 透傳到捲動容器（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLElement>;
  /** 要顯示的資料；通常是 API 回來的 JSON。 */
  value: unknown;
  /** 超過這個高度就在框內捲動（預設 `20rem`）。 */
  maxHeight?: CSSProperties['maxHeight'];
  /** 這個深度（含）以下的物件／陣列一開始是收合的；根節點深度為 0。預設全部展開。 */
  defaultExpandDepth?: number;
  /** 行數超過這個值才虛擬捲動。預設 100。 */
  virtualThreshold?: number;
  /** 預設文案是繁中；`features/` 使用時以 `t()` 傳入。 */
  labels?: JsonViewerLabels;
  className?: string;
  style?: CSSProperties;
  /** 捲動框的名稱（讓它成為 `region` 地標）。 */
  'aria-label'?: string;
  'data-testid'?: string;
}

const DEFAULT_MAX_HEIGHT = '20rem';
const EMPTY_PATHS: ReadonlySet<string> = new Set();
/** 與 CSS 的 `.line` 高度（1.25rem）一致，捲動時不需修正位置。 */
const LINE_HEIGHT = 20;

const PRIMITIVE_CLASS = {
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

interface LineProps {
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
}: LineProps) {
  const isToggleable = line.type === 'open' || (line.type === 'collapsed' && line.size > 0);
  const isExpanded = line.type === 'open';
  const style: CSSProperties = {
    ...lineSlot.style,
    paddingInlineStart: `${line.depth * 2}ch`,
    // 虛擬捲動：寬度不設 100%（長的行要能撐出水平捲動），只保證至少和框一樣寬
    ...(start !== undefined && {
      position: 'absolute',
      top: 0,
      left: 0,
      transform: `translateY(${start}px)`,
    }),
  };

  let body: ReactNode;
  if (line.type === 'value') {
    body = <span className={PRIMITIVE_CLASS[line.kind]}>{line.text}</span>;
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
      {line.key !== undefined && (
        <>
          {/* 與 svelte-jsoneditor 的 tree 模式一樣，鍵名不加引號 */}
          <span className={styles.key}>{line.key}</span>
          <span className={styles.punctuation}>: </span>
        </>
      )}
      {body}
      {line.comma && <span className={styles.punctuation}>,</span>}
    </div>
  );
}

/**
 * JSON 預覽：語法上色、物件／陣列可收合、超過 `maxHeight` 在框內捲動；
 * 行數超過門檻時以 `useVirtualRows` 虛擬捲動，只渲染看得到的行，資料再大也不會卡。
 */
export function JsonViewer({
  ref,
  value,
  maxHeight = DEFAULT_MAX_HEIGHT,
  defaultExpandDepth = Infinity,
  virtualThreshold,
  labels,
  className,
  style,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: JsonViewerProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const composedRef = useCallback(
    (element: HTMLElement | null) => {
      setScrollElement(element);
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );

  // 記的是「與預設相反」的節點；換一份資料就回到預設
  const [toggled, setToggled] = useState({ value, paths: EMPTY_PATHS });
  const toggledPaths = toggled.value === value ? toggled.paths : EMPTY_PATHS;

  const onToggle = useCallback(
    (path: string) =>
      setToggled((previous) => {
        const paths = new Set(previous.value === value ? previous.paths : EMPTY_PATHS);
        if (!paths.delete(path)) paths.add(path);
        return { value, paths };
      }),
    [value],
  );

  const lines = useMemo(
    () =>
      toJsonLines(value, (path, depth) => depth >= defaultExpandDepth !== toggledPaths.has(path)),
    [value, defaultExpandDepth, toggledPaths],
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
            />
          );
        })}
      </div>
    </section>
  );
}

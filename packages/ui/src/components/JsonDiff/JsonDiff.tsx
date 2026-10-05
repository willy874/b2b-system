import { cn } from '@b2b-system/web-shared/utils';
import { useCallback, useMemo, useState } from 'react';
import type { CSSProperties, Ref } from 'react';

import { DEFAULT_JSON_MAX_HEIGHT } from '../JsonViewer';
import { createSlots } from '../slots';
import type { SlotAttributes, SlotOverrides } from '../slots';
import { useVirtualRows } from '../VirtualList';
import { diffJsonLines, tokenizeJsonLine, toJsonDiffRows } from './diffLines';
import type { JsonDiffFold, JsonDiffKind, JsonDiffLine, JsonTokenKind } from './diffLines';

import theme from '../JsonViewer/jsonTheme.module.css';
import styles from './JsonDiff.module.css';

/** `className` / `style` / `data-testid` 落在捲動容器；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type JsonDiffSlot = 'lines' | 'line' | 'fold';

export interface JsonDiffLabels {
  /** 摺疊列的文字，例如「展開 12 行未變更」。 */
  expandUnchanged?: (count: number) => string;
  /** 兩邊內容相同（或都不存在）時顯示的文字。 */
  empty?: string;
}

export interface JsonDiffProps extends SlotOverrides<JsonDiffSlot> {
  /** 透傳到捲動容器（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLElement>;
  /** 變更前；`undefined` 表示不存在（例如建立），整份新版都是新增。 */
  before: unknown;
  /** 變更後；`undefined` 表示不存在（例如刪除），整份舊版都是刪除。 */
  after: unknown;
  /** 變更前後各保留幾行未變更的內容，其餘收成摺疊列。預設 3；`Infinity` 全部顯示。 */
  context?: number;
  /** 超過這個高度就在框內捲動（預設 `20rem`，與 `JsonViewer` 相同）。 */
  maxHeight?: CSSProperties['maxHeight'];
  /** 列數超過這個值才虛擬捲動。預設 100。 */
  virtualThreshold?: number;
  /** 預設文案是繁中；`features/` 使用時以 `t()` 傳入。 */
  labels?: JsonDiffLabels;
  className?: string;
  style?: CSSProperties;
  /** 捲動框的名稱（讓它成為 `region` 地標）。 */
  'aria-label'?: string;
  'data-testid'?: string;
}

const DEFAULT_CONTEXT = 3;

/** 與 CSS 的 `--json-line-height`（1.25rem）一致。 */
const LINE_HEIGHT = 20;

/** 行號欄至少兩位數寬（與 JsonViewer 一致）。 */
const MIN_LINE_NUMBER_DIGITS = 2;

const TOKEN_CLASS = {
  key: theme.key,
  string: theme.string,
  number: theme.number,
  boolean: theme.boolean,
  null: theme.null,
  punctuation: theme.punctuation,
  space: undefined,
} as const satisfies Record<JsonTokenKind, string | undefined>;

const MARKER = {
  equal: ' ',
  added: '+',
  removed: '-',
} as const satisfies Record<JsonDiffKind, string>;

const defaultExpandUnchanged = (count: number) => `展開 ${count} 行未變更`;

const EMPTY_FOLDS: ReadonlySet<number> = new Set();

interface FoldState {
  resetKey: unknown;
  expanded: ReadonlySet<number>;
}

interface RowProps {
  index: number;
  /** 虛擬捲動時的列頂位置（px）；未虛擬化時為 `undefined`。 */
  start: number | undefined;
  measureElement: ((element: Element | null) => void) | undefined;
  slot: SlotAttributes;
}

const positionStyle = (start: number | undefined, style: CSSProperties | undefined) =>
  start === undefined
    ? style
    : ({
        ...style,
        position: 'absolute',
        top: 0,
        left: 0,
        transform: `translateY(${start}px)`,
      } satisfies CSSProperties);

function Line({ line, index, start, measureElement, slot }: RowProps & { line: JsonDiffLine }) {
  const tokens = useMemo(() => tokenizeJsonLine(line.text), [line.text]);
  return (
    <div
      ref={measureElement}
      data-index={index}
      className={cn(styles.line, slot.className)}
      style={positionStyle(start, slot.style)}
      data-testid={slot['data-testid']}
      data-value={line.kind}
      data-old-line-number={line.oldLineNumber}
      data-new-line-number={line.newLineNumber}
    >
      <span className={styles.gutter} aria-hidden>
        <span className={styles.lineNumber}>{line.oldLineNumber}</span>
        <span className={styles.lineNumber}>{line.newLineNumber}</span>
      </span>
      <span className={styles.marker}>{MARKER[line.kind]}</span>
      <span className={styles.content}>
        {tokens.map((token, position) => (
          // 片段的順序固定，以位置當 key
          // oxlint-disable-next-line react/no-array-index-key
          <span key={position} className={TOKEN_CLASS[token.kind]}>
            {token.text}
          </span>
        ))}
      </span>
    </div>
  );
}

function Fold({
  fold,
  index,
  start,
  measureElement,
  slot,
  label,
  onExpand,
}: RowProps & { fold: JsonDiffFold; label: string; onExpand: (start: number) => void }) {
  return (
    <div
      ref={measureElement}
      data-index={index}
      className={styles.foldRow}
      style={positionStyle(start, undefined)}
    >
      <button
        type="button"
        className={cn(styles.fold, slot.className)}
        style={slot.style}
        data-testid={slot['data-testid']}
        data-value={fold.start}
        onClick={() => onExpand(fold.start)}
      >
        <span className={theme.foldMarker} />
        {label}
      </button>
    </div>
  );
}

/**
 * 兩份 JSON 的逐行差異（unified diff）：刪除的行以 danger、新增的行以 success 底色標示，
 * 行號欄並列舊版／新版行號；文字與 `JSON.stringify(value, null, 2)` 相同，語法上色與 `JsonViewer` 一致。
 * 未變更的內容只保留變更前後 `context` 行，其餘收成可展開的摺疊列；列數多時虛擬捲動。
 * 換一份 `before` / `after` 時摺疊狀態回到預設。
 */
export function JsonDiff({
  ref,
  before,
  after,
  context = DEFAULT_CONTEXT,
  maxHeight = DEFAULT_JSON_MAX_HEIGHT,
  virtualThreshold,
  labels,
  className,
  style,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: JsonDiffProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const lines = useMemo(() => diffJsonLines(before, after), [before, after]);

  const [folds, setFolds] = useState<FoldState>({ resetKey: lines, expanded: EMPTY_FOLDS });
  const expanded = folds.resetKey === lines ? folds.expanded : EMPTY_FOLDS;
  const expand = useCallback(
    (start: number) =>
      setFolds((previous) => ({
        resetKey: lines,
        expanded: new Set(previous.resetKey === lines ? previous.expanded : EMPTY_FOLDS).add(start),
      })),
    [lines],
  );

  const rows = useMemo(() => toJsonDiffRows(lines, context, expanded), [lines, context, expanded]);
  const hasChanges = lines.some((line) => line.kind !== 'equal');

  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const composedRef = useCallback(
    (element: HTMLElement | null) => {
      setScrollElement(element);
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );

  const virtual = useVirtualRows({
    count: hasChanges ? rows.length : 0,
    scrollElement,
    estimateSize: LINE_HEIGHT,
    threshold: virtualThreshold,
  });

  const maxLineNumber = lines.reduce(
    (max, line) => Math.max(max, line.oldLineNumber ?? 0, line.newLineNumber ?? 0),
    1,
  );
  const digits = Math.max(MIN_LINE_NUMBER_DIGITS, String(maxLineNumber).length);
  const linesSlot = slot('lines', styles.lines);
  const lineSlot = slot('line', undefined, { testId: 'json-diff-item' });
  const foldSlot = slot('fold', undefined, { testId: 'json-diff-fold' });
  const expandLabel = labels?.expandUnchanged ?? defaultExpandUnchanged;

  return (
    // 帶 aria-label 的 <section> 是 region；可捲動的容器瀏覽器本身就能用鍵盤聚焦捲動
    <section
      ref={composedRef}
      className={cn(theme.theme, styles.root, className)}
      style={{ maxHeight, '--json-line-number-digits': digits, ...style } as CSSProperties}
      data-empty={!hasChanges || undefined}
      {...rest}
    >
      {hasChanges ? (
        <div
          className={linesSlot.className}
          style={
            virtual.containerStyle
              ? { ...linesSlot.style, ...virtual.containerStyle }
              : linesSlot.style
          }
          data-testid={linesSlot['data-testid']}
        >
          {virtual.rows.map(({ index, start }) => {
            const row = rows[index] as (typeof rows)[number];
            const position = { index, start, measureElement: virtual.measureElement };
            return row.kind === 'fold' ? (
              <Fold
                key={`fold-${row.start}`}
                fold={row}
                {...position}
                slot={foldSlot}
                label={expandLabel(row.count)}
                onExpand={expand}
              />
            ) : (
              <Line
                key={`${row.oldLineNumber}-${row.newLineNumber}`}
                line={row}
                {...position}
                slot={lineSlot}
              />
            );
          })}
        </div>
      ) : (
        <p className={styles.empty}>{labels?.empty ?? '沒有變更'}</p>
      )}
    </section>
  );
}

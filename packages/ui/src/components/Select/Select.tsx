import { cn } from '@b2b-system/web-shared/utils';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { BoxEllipsis } from '../Ellipsis';
import { useFieldControl } from '../Field/fieldControl';
import { Icon } from '../Icon';
import { useComponentLabels } from '../labels';
import { createSlots } from '../slots';
import { Spinner } from '../Spinner';
import { useInfiniteScroll, useVirtualRows } from '../VirtualList';
import type { SelectProps } from './selectProps';
import { SelectRowView } from './SelectRowView';
import { useSelectActions } from './useSelectActions';
import { useSelectModel } from './useSelectModel';

import styles from './Select.module.css';

export type { CheckState, SelectFilter, SelectOption, SelectSortOrder } from './selectModel';
export { defaultFilterOption } from './selectModel';
export type { MultipleSelectProps, SelectProps, SingleSelectProps } from './selectProps';
export type { SelectSlot } from './selectSlots';

const DEFAULT_ITEM_SIZE = 32;
/** 觸發鈕最多實際渲染幾個標籤再交給 BoxEllipsis 量測；全選上萬筆時不必每個都量。 */
const MAX_RENDERED_TAGS = 50;

/**
 * 下拉選擇，單選或多選（`multiple`）。
 *
 * - 以 Base UI Popover 負責定位、點外面／Esc 關閉與焦點歸還；列表以 `aria-activedescendant`
 *   自己管理作用列，才能虛擬捲動（Base UI Select 需要所有選項都掛在 DOM 上）。
 * - 列數多時自動虛擬捲動；傳 `onLoadMore` ＋ `hasMore` 即為無限捲動。
 * - 選項有 `children` 時成為可展開的樹（role="tree"）。
 *
 * 資料與狀態在 `useSelectModel`，作用列、勾選與鍵盤在 `useSelectActions`；這裡只渲染。
 */
export function Select<T extends string = string>(props: SelectProps<T>) {
  // 沒有明確傳入的文案用目前語系（ComponentLabelsContext），英文介面不會漏出中文預設值
  const labels = useComponentLabels();
  const {
    ref,
    placeholder,
    disabled,
    invalid,
    size = 'md',
    searchPlaceholder = labels.selectSearch,
    searchLabel,
    noMatchLabel = labels.selectNoMatch,
    hasMore,
    loading,
    onLoadMore,
    loadingLabel = labels.selectLoading,
    emptyLabel,
    virtualThreshold,
    itemSize = DEFAULT_ITEM_SIZE,
    className,
    style,
    classNames,
    styles: styleOverrides,
    testIds,
    'aria-label': ariaLabel,
    'data-testid': testId,
  } = props;

  const slot = useMemo(
    () => createSlots({ classNames, styles: styleOverrides, testIds }),
    [classNames, styleOverrides, testIds],
  );
  // 放在 Field 裡時：名稱、說明、錯誤狀態取自 Field（Popover.Trigger 登記不到 Base UI 的 Field）
  const field = useFieldControl();
  const labelledBy = ariaLabel ? undefined : field?.labelId;
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = useCallback((index: number) => `${baseId}-${index}`, [baseId]);

  const model = useSelectModel(props);
  const {
    multi,
    isMultiple,
    selectableGroups,
    searchable,
    isTree,
    index,
    shownExpanded,
    open,
    setOpen,
    search,
    setSearch,
    deferredSearch,
    rows,
    rowState,
    isRowDisabled,
    displayValues,
  } = model;

  // ── 捲動 ─────────────────────────────────────────────
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const {
    rows: visibleRows,
    containerStyle,
    measureElement,
    scrollToIndex,
  } = useVirtualRows({
    count: rows.length,
    scrollElement,
    estimateSize: itemSize,
    threshold: virtualThreshold,
  });
  const { onScroll } = useInfiniteScroll({
    scrollElement,
    count: rows.length,
    hasMore,
    loading,
    onLoadMore,
    // 換關鍵字等於換一份資料：解除分頁的鎖
    resetKey: deferredSearch,
  });

  const { activeIndex, setActiveIndex, pick, toggleExpand, onListKeyDown } = useSelectActions(
    model,
    { scrollElement, scrollToIndex, inputRef },
  );

  // ── 觸發鈕上的值 ─────────────────────────────────────
  const labelOf = (value: T): ReactNode => index.byValue.get(value)?.label ?? value;
  const renderedTags = displayValues.slice(0, MAX_RENDERED_TAGS);
  const unrenderedCount = displayValues.length - renderedTags.length;

  let display: ReactNode;
  if (displayValues.length === 0) {
    display = <span {...slot('placeholder', styles.placeholder)}>{placeholder ?? ''}</span>;
  } else if (!isMultiple) {
    display = labelOf(displayValues[0] as T);
  } else {
    display = (
      <BoxEllipsis
        className={styles.tags}
        maxVisible={multi?.maxTagCount}
        overflowTooltip={false}
        renderOverflow={({ hiddenCount }) => (
          <span className={styles.tag} data-overflow>
            +{hiddenCount + unrenderedCount}
          </span>
        )}
      >
        {renderedTags.map((value) => (
          <span
            key={value}
            {...slot('tag', styles.tag, { testId: 'select-tag' })}
            data-value={value}
          >
            {labelOf(value)}
          </span>
        ))}
      </BoxEllipsis>
    );
  }

  const listSlot = slot('list', styles.list);
  const emptyContent =
    rows.length === 0 && !loading ? (search.trim() ? noMatchLabel : emptyLabel) : undefined;
  const activeId = activeIndex >= 0 ? optionId(activeIndex) : undefined;

  return (
    <BasePopover.Root open={open} onOpenChange={(next) => setOpen(next)}>
      <BasePopover.Trigger
        ref={ref}
        id={field?.controlId}
        disabled={disabled}
        // 「只能選、不能打字」的 combobox 用 button 實作（WAI-ARIA APG 的 select-only combobox）
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="combobox"
        aria-haspopup={isTree ? 'tree' : 'listbox'}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={field?.describedBy}
        aria-invalid={invalid || field?.invalid || undefined}
        className={cn(styles.trigger, className)}
        style={style}
        data-testid={testId}
        data-size={size}
        data-multiple={isMultiple || undefined}
        data-placeholder={displayValues.length === 0 || undefined}
        onKeyDown={(event: KeyboardEvent) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span {...slot('value', styles.value)}>{display}</span>
        <span {...slot('icon', styles.icon)}>
          <Icon name="chevron-down" size={16} />
        </span>
      </BasePopover.Trigger>
      <BasePopover.Portal>
        <BasePopover.Positioner sideOffset={4} {...slot('positioner', styles.positioner)}>
          <BasePopover.Popup
            role="presentation"
            initialFocus={searchable ? inputRef : listRef}
            {...slot('popup', styles.popup)}
          >
            {searchable && (
              <div {...slot('search', styles.search)}>
                <Icon name="search" size={14} />
                <input
                  ref={inputRef}
                  type="text"
                  role="combobox"
                  aria-expanded={open}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={activeId}
                  aria-label={searchLabel ?? searchPlaceholder}
                  placeholder={searchPlaceholder}
                  value={search}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={onListKeyDown}
                  {...slot('searchInput', styles.searchInput, { testId: 'select-search' })}
                />
              </div>
            )}
            {/* 捲動容器獨立一層：搜尋框固定在上方，虛擬捲動與無限捲動只量列表 */}
            <div ref={setScrollElement} onScroll={onScroll} {...slot('scroller', styles.scroller)}>
              {/* role 依是否為樹而定，lint 無法靜態判斷 */}
              {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
              <div
                ref={listRef}
                id={listId}
                role={isTree ? 'tree' : 'listbox'}
                tabIndex={-1}
                aria-label={ariaLabel}
                aria-labelledby={labelledBy}
                aria-multiselectable={isMultiple || undefined}
                // 有搜尋框時焦點在輸入框上，由它宣告 aria-activedescendant
                aria-activedescendant={searchable ? undefined : activeId}
                onKeyDown={onListKeyDown}
                className={listSlot.className}
                style={containerStyle ? { ...listSlot.style, ...containerStyle } : listSlot.style}
                data-testid={listSlot['data-testid']}
                data-multiple={isMultiple || undefined}
              >
                {visibleRows.map(({ index: rowIndex, start }) => {
                  const row = rows[rowIndex];
                  if (!row) return null;
                  return (
                    <SelectRowView<T>
                      key={row.key}
                      row={row}
                      index={rowIndex}
                      id={optionId(rowIndex)}
                      start={start}
                      isActive={rowIndex === activeIndex}
                      isDisabled={isRowDisabled(row)}
                      isExpanded={row.kind === 'option' && shownExpanded.has(row.key)}
                      state={rowState(row)}
                      isMultiple={isMultiple}
                      isTree={isTree}
                      isGroupSelectable={selectableGroups}
                      label={
                        row.kind === 'all'
                          ? (multi?.selectAllLabel ?? labels.selectAll)
                          : row.option.label
                      }
                      description={row.kind === 'option' ? row.option.description : undefined}
                      slot={slot}
                      measureElement={measureElement}
                      onPick={pick}
                      onToggleExpand={toggleExpand}
                      onHover={setActiveIndex}
                    />
                  );
                })}
              </div>
              {(loading || emptyContent) && (
                <div {...slot('footer', styles.footer, { testId: 'select-footer' })}>
                  {loading ? <Spinner size={16} label={loadingLabel} /> : emptyContent}
                </div>
              )}
            </div>
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

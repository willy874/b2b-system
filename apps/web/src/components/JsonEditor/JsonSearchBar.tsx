import type { KeyboardEvent, Ref } from 'react';

import { IconButton } from '../Button';
import { Icon } from '../Icon';
import type { SlotAttributes } from '../slots';

import styles from './JsonEditor.module.css';

interface JsonSearchBarProps {
  inputRef: Ref<HTMLInputElement>;
  query: string;
  /** 目前是第幾筆（0 起算）；沒有結果時為 -1。 */
  activeIndex: number;
  total: number;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  labels: {
    search: string;
    searchPlaceholder: string;
    previousMatch: string;
    nextMatch: string;
    closeSearch: string;
    noMatch: string;
    matchCount: (active: number, total: number) => string;
  };
  slotAttributes: SlotAttributes;
}

/** 樹狀模式的搜尋列（對應 svelte-jsoneditor 的搜尋框）；Enter 下一筆、Shift + Enter 上一筆、Esc 關閉。 */
export function JsonSearchBar({
  inputRef,
  query,
  activeIndex,
  total,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
  labels,
  slotAttributes,
}: JsonSearchBarProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) onPrevious();
      else onNext();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const hasQuery = query.trim() !== '';
  const status = !hasQuery
    ? ''
    : total === 0
      ? labels.noMatch
      : labels.matchCount(activeIndex + 1, total);

  return (
    <search {...slotAttributes}>
      <Icon name="search" size={14} className={styles.searchIcon} />
      <input
        ref={inputRef}
        // 打開搜尋列就是要打字
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        type="search"
        value={query}
        placeholder={labels.searchPlaceholder}
        aria-label={labels.search}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className={styles.searchInput}
        data-testid="json-editor-search-input"
      />
      <output
        className={styles.searchStatus}
        aria-live="polite"
        data-testid="json-editor-search-status"
      >
        {status}
      </output>
      <IconButton
        size="sm"
        aria-label={labels.previousMatch}
        onClick={onPrevious}
        disabled={total === 0}
      >
        <Icon name="arrow-up" size={14} />
      </IconButton>
      <IconButton size="sm" aria-label={labels.nextMatch} onClick={onNext} disabled={total === 0}>
        <Icon name="arrow-down" size={14} />
      </IconButton>
      <IconButton size="sm" aria-label={labels.closeSearch} onClick={onClose}>
        <Icon name="close" size={14} />
      </IconButton>
    </search>
  );
}

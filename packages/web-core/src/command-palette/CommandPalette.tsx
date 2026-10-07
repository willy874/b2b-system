import { Dialog } from '@b2b-system/ui/Dialog';
import { Icon } from '@b2b-system/ui/Icon';
import { Spinner } from '@b2b-system/ui/Spinner';
import { useListNavigation } from '@b2b-system/ui/VirtualList';
import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useTranslation } from '../locales';
import { useCommandPaletteStore } from './store';
import { usePaletteSections } from './usePaletteSections';
import type { PaletteAction, PaletteOption } from './usePaletteSections';

import styles from './CommandPalette.module.css';

/** 交給列表導覽的按鍵；其餘（Home／End、左右鍵）留給輸入框移動游標。 */
const LIST_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp']);

/**
 * 命令面板（⌘K）：頁面、最近造訪、動作與資料搜尋（docs/architecture/frontend/18-command-palette.md）。
 * 外框（`DashboardShell`）掛一個；開關在 `useCommandPaletteStore`。
 */
export function CommandPalette() {
  const { t } = useTranslation();
  const open = useCommandPaletteStore((state) => state.open);
  const setOpen = useCommandPaletteStore((state) => state.setOpen);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('commandPalette.title')}
      size="md"
      className={styles.popup}
      classNames={{ header: styles.header, body: styles.body }}
      data-testid="command-palette"
    >
      {/* 關閉時對話框的內容卸載，下次打開是空的輸入框 */}
      <PaletteContent onClose={() => setOpen(false)} />
    </Dialog>
  );
}

function PaletteContent({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const [query, setQuery] = useState('');
  const { sections, isSearching } = usePaletteSections(query);
  const options = sections.flatMap((section) => section.options);
  const optionDomId = (index: number) => `${baseId}-option-${index}`;

  const nav = useListNavigation({
    count: options.length,
    isDisabled: () => false,
    loop: true,
    // jsdom 沒有 scrollIntoView（與 ui 的 useVirtualRows 相同）
    onNavigate: (index) =>
      document.getElementById(optionDomId(index))?.scrollIntoView?.({ block: 'nearest' }),
  });
  // 沒有用方向鍵選過時，Enter 開第一個（打完字直接 Enter 是最常見的用法）
  const activeIndex = nav.activeIndex >= 0 ? nav.activeIndex : options.length > 0 ? 0 : -1;

  const changeQuery = (value: string) => {
    setQuery(value);
    nav.setActiveIndex(-1);
  };

  const runAction = (action: PaletteAction) => {
    onClose();
    if (action.type === 'run') {
      action.run();
      return;
    }
    void navigate({ to: action.to, params: action.params, search: action.search });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (LIST_KEYS.has(event.key)) {
      if (nav.activeIndex < 0 && activeIndex >= 0 && event.key === 'ArrowDown') {
        // 第一列已經是預設的作用列，往下一格才是第二列
        event.preventDefault();
        nav.navigateTo(Math.min(1, options.length - 1));
        return;
      }
      nav.handleKeyDown(event);
      return;
    }
    if (event.key === 'Enter') {
      const option = options[activeIndex];
      if (!option) return;
      event.preventDefault();
      runAction(option.action);
    }
  };

  // 每個分組第一個選項在整個列表的位置（作用列與 DOM id 用整個列表的 index）
  const sectionStarts = sections.map((_, sectionIndex) =>
    sections.slice(0, sectionIndex).reduce((count, previous) => count + previous.options.length, 0),
  );
  const isEmpty = sections.length === 0 && !isSearching;

  return (
    <div className={styles.content}>
      <div className={styles.searchRow}>
        <Icon name="search" size={16} className={styles.searchIcon} />
        <input
          className={styles.input}
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('commandPalette.placeholder')}
          aria-label={t('commandPalette.placeholder')}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionDomId(activeIndex) : undefined}
          autoComplete="off"
          spellCheck={false}
          data-testid="command-palette-input"
        />
      </div>
      <div
        id={listId}
        // 不是原生 <select>／<datalist>：選項要放圖示與兩行文字，焦點留在輸入框（aria-activedescendant）
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="listbox"
        aria-label={t('commandPalette.title')}
        className={styles.list}
      >
        {sections.map((section, sectionIndex) => {
          const headingId = `${baseId}-${section.key}`;
          const start = sectionStarts[sectionIndex] ?? 0;
          return (
            <div
              key={section.key}
              // listbox 裡的分組只能是 role="group"（fieldset 不能放在 listbox 裡）
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
              role="group"
              aria-labelledby={headingId}
              className={styles.section}
              data-testid="command-palette-section"
              data-value={section.key}
            >
              <div id={headingId} role="presentation" className={styles.sectionTitle}>
                {t(section.titleKey)}
              </div>
              {section.status === 'loading' && (
                <div className={styles.status} data-testid="command-palette-loading">
                  <Spinner size={14} />
                  {t('commandPalette.searching')}
                </div>
              )}
              {section.status === 'error' && (
                <div className={styles.status} data-testid="command-palette-error">
                  {t('commandPalette.searchFailed')}
                </div>
              )}
              {section.options.map((option, offset) => {
                const optionIndex = start + offset;
                return (
                  <PaletteOptionRow
                    key={option.id}
                    id={optionDomId(optionIndex)}
                    option={option}
                    active={optionIndex === activeIndex}
                    onHover={() => nav.setActiveIndex(optionIndex)}
                    onPick={() => runAction(option.action)}
                  />
                );
              })}
            </div>
          );
        })}
        {isEmpty && (
          <div className={styles.empty} data-testid="command-palette-empty">
            {t('commandPalette.noResults')}
          </div>
        )}
      </div>
      <div className={styles.hints} aria-hidden="true">
        <span>{t('commandPalette.hint.navigate')}</span>
        <span>{t('commandPalette.hint.open')}</span>
        <span>{t('commandPalette.hint.close')}</span>
      </div>
    </div>
  );
}

interface PaletteOptionRowProps {
  id: string;
  option: PaletteOption;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}

function PaletteOptionRow({ id, option, active, onHover, onPick }: PaletteOptionRowProps) {
  return (
    // 鍵盤操作與焦點都在輸入框上（aria-activedescendant），選項本身只接滑鼠、不可聚焦；
    // 不用原生 <option>：它只能放純文字
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
    <div
      id={id}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="option"
      aria-selected={active}
      className={styles.option}
      data-active={active || undefined}
      onMouseMove={onHover}
      // 不讓滑鼠按下搶走輸入框的焦點
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
      data-testid="command-palette-item"
      data-value={option.id}
    >
      <Icon name={option.icon} size={16} className={styles.optionIcon} />
      <span className={styles.optionText}>
        <span className={styles.optionLabel}>{option.label}</span>
        {option.description && (
          <span className={styles.optionDescription}>{option.description}</span>
        )}
      </span>
    </div>
  );
}

import { Button, IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Popover } from '@b2b-system/ui/Popover';
import { createSlots } from '@b2b-system/ui/slots';
import type { SlotOverrides } from '@b2b-system/ui/slots';
import { cn } from '@b2b-system/web-shared/utils';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { useTranslation } from '../../../locales';
import { isFilterActive } from './filter-utils';
import { FilterControl } from './FilterControl';
import type { AnyFilterField, FilterBarLabels, FilterBarSlot, FilterField } from './types';

import styles from './FilterBar.module.css';

export interface FilterBarProps<
  TValues extends Record<string, unknown> = Record<string, unknown>,
> extends SlotOverrides<FilterBarSlot> {
  /** 依序排成面板裡的表單；每個欄位的 `key` 對應 `value` 的一個屬性。 */
  fields: Array<FilterField<TValues>>;
  /** 目前生效的篩選值（通常來自網址）。打開面板時以它為草稿的起點。 */
  value: TValues;
  /** 按「搜尋」（或在文字欄位按 Enter）時一次送出整份草稿。 */
  onSubmit: (value: TValues) => void;
  /** 「清除」把草稿換成這個值（仍要按「搜尋」才生效）；不提供時不顯示「清除」。 */
  defaultValue?: TValues;
  labels?: FilterBarLabels;
  className?: string;
  'data-testid'?: string;
}

/**
 * 列表頁的篩選：一顆篩選圖示按鈕（有值時角落顯示數量），點開是所有欄位的表單。
 * 面板裡的修改只改草稿，按「搜尋」才一次送出；關掉面板就放棄草稿。
 * 一次送出也讓頁面只需要更新一次網址（docs/architecture/frontend/09-state-and-storage.md §1）。
 * `RichTable` 會把它固定在最後一欄表頭的右側（與標題垂直置中）。
 */
export function FilterBar<TValues extends Record<string, unknown>>({
  fields,
  value,
  onSubmit,
  defaultValue,
  labels,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  'data-testid': testId = 'filter-bar-trigger',
}: FilterBarProps<TValues>) {
  const { t } = useTranslation();
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  // 泛型內 TS 無法展開延遲求值的 `FilterField<TValues>`；它的每個成員都是 `AnyFilterField` 之一
  // （見 types.ts 的 `FieldFor`），這是唯一一處轉型，控制項只需要不分 key 的欄位型別
  const anyFields = fields as AnyFilterField[];
  const activeCount = anyFields.filter((field) =>
    isFilterActive(field, value[field.key], defaultValue?.[field.key]),
  ).length;

  const handleOpenChange = (next: boolean) => {
    // 每次打開都從目前生效的值開始編輯
    if (next) setDraft(value);
    setOpen(next);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(trimTextFields(anyFields, draft));
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      align="end"
      {...slot('popup', styles.popup, { testId: 'filter-bar-popup' })}
      trigger={
        <IconButton
          size="sm"
          aria-label={
            activeCount > 0 ? t('common.filterActive', { count: activeCount }) : t('common.filter')
          }
          className={cn(styles.trigger, className)}
          data-active={activeCount > 0 || undefined}
          data-testid={testId}
        >
          <Icon name="filter" size={16} />
          {/* 數量已含在 aria-label，徽章只給視覺 */}
          {activeCount > 0 && (
            <span aria-hidden {...slot('count', styles.count)}>
              {activeCount}
            </span>
          )}
        </IconButton>
      }
    >
      <form {...slot('form', styles.form)} onSubmit={handleSubmit}>
        {anyFields.map((field) => (
          <div
            key={field.key}
            {...slot('field', styles.field, { testId: 'filter-bar-field' })}
            data-value={field.key}
          >
            {/* 控制項各自以 aria-label 命名，這裡只是視覺標題 */}
            <span {...slot('fieldLabel', styles.fieldLabel)} aria-hidden>
              {field.label}
            </span>
            <FilterControl
              field={field}
              value={draft[field.key]}
              onChange={(next) => setDraft((previous) => ({ ...previous, [field.key]: next }))}
            />
          </div>
        ))}

        <div {...slot('footer', styles.footer)}>
          {defaultValue && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDraft(defaultValue)}
              {...slot('reset', undefined, { testId: 'filter-bar-reset' })}
            >
              {labels?.reset ?? t('common.clear')}
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            variant="primary"
            {...slot('submit', undefined, { testId: 'filter-bar-submit' })}
          >
            {labels?.submit ?? t('common.search')}
          </Button>
        </div>
      </form>
    </Popover>
  );
}

/** 文字欄位送出前去掉前後空白，只剩空白就視為沒有輸入。 */
function trimTextFields<TValues extends Record<string, unknown>>(
  fields: AnyFilterField[],
  draft: TValues,
): TValues {
  const trimmed = fields.flatMap((field) => {
    const text = draft[field.key];
    return field.type === 'text' && typeof text === 'string'
      ? [[field.key, text.trim() || undefined] as const]
      : [];
  });
  return { ...draft, ...Object.fromEntries(trimmed) };
}

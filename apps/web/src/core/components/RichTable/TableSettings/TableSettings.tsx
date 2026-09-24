import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';

import { Button, IconButton } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { Icon } from '@/components/Icon';
import { Popover } from '@/components/Popover';
import { createSlots } from '@/components/slots';
import type { SlotOverrides, SlotResolver } from '@/components/slots';
import { useTranslation } from '@/core/locales';
import type { TableColumnSettings } from '@/core/store';

import styles from './TableSettings.module.css';

export interface TableSettingsColumn {
  id: string;
  label: string;
}

/** `className` / `data-testid` 落在齒輪按鈕；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type TableSettingsSlot =
  | 'popup'
  | 'title'
  | 'list'
  | 'item'
  | 'dragHandle'
  | 'footer'
  | 'reset'
  | 'submit';

export interface TableSettingsLabels {
  /** 預設 `common.restoreDefault`。 */
  reset?: string;
  /** 預設 `common.apply`。 */
  submit?: string;
}

export interface TableSettingsProps extends SlotOverrides<TableSettingsSlot> {
  /** 可以設定的欄位（不含固定的操作欄）。 */
  columns: TableSettingsColumn[];
  /** 目前生效的設定（已與 `columns` 合併過，`resolveColumnSettings`）。 */
  value: TableColumnSettings;
  /** 「恢復預設」回到的設定。 */
  defaultValue: TableColumnSettings;
  /** 按「套用」時呼叫；草稿與預設相同時改呼叫 `onReset`，不留下多餘的設定。 */
  onChange: (next: TableColumnSettings) => void;
  onReset: () => void;
  labels?: TableSettingsLabels;
  className?: string;
  'data-testid'?: string;
}

/**
 * 欄位設定：齒輪按鈕點開的下拉面板。拖曳調整順序、勾選決定是否顯示，這些都只改草稿；
 * 按「套用」才寫入，關掉面板就放棄草稿。至少保留一個欄位顯示。
 * 拖曳的操作方式參考 merak-client 的 ColumnSettings（dnd-kit，含鍵盤操作）。
 */
export function TableSettings({
  columns,
  value,
  defaultValue,
  onChange,
  onReset,
  labels,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  'data-testid': testId = 'table-settings-trigger',
}: TableSettingsProps) {
  const { t } = useTranslation();
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const sensors = useSensors(
    // 移動一小段距離才開始拖曳，單純點擊把手不會被當成拖曳
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const labelsById = new Map(columns.map((column) => [column.id, column.label]));
  const visibleCount = draft.order.filter((id) => !draft.hidden.includes(id)).length;

  const handleOpenChange = (next: boolean) => {
    // 每次打開都從目前生效的設定開始編輯
    if (next) setDraft(value);
    setOpen(next);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = draft.order.indexOf(String(active.id));
    const to = draft.order.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    setDraft({ ...draft, order: arrayMove(draft.order, from, to) });
  };

  const toggle = (id: string, visible: boolean) => {
    const hidden = visible ? draft.hidden.filter((item) => item !== id) : [...draft.hidden, id];
    setDraft({ ...draft, hidden });
  };

  const submit = () => {
    if (isSameSettings(draft, defaultValue)) onReset();
    else onChange(draft);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      align="end"
      {...slot('popup', styles.popup, { testId: 'table-settings-popup' })}
      trigger={
        <IconButton
          size="sm"
          aria-label={t('common.tableSettings')}
          className={className}
          data-testid={testId}
        >
          <Icon name="settings" size={16} />
        </IconButton>
      }
    >
      <p {...slot('title', styles.title)}>{t('common.tableSettings')}</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={draft.order} strategy={verticalListSortingStrategy}>
          <ul {...slot('list', styles.list)}>
            {draft.order.map((id) => {
              const visible = !draft.hidden.includes(id);
              const label = labelsById.get(id) ?? id;
              return (
                <SortableItem
                  key={id}
                  id={id}
                  label={label}
                  visible={visible}
                  // 最後一個顯示中的欄位不能取消，表格才不會變成空的
                  locked={visible && visibleCount === 1}
                  dragLabel={t('common.dragToReorder', { name: label })}
                  onToggle={toggle}
                  slot={slot}
                />
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
      <div {...slot('footer', styles.footer)}>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDraft(defaultValue)}
          {...slot('reset', undefined, { testId: 'table-settings-reset' })}
        >
          {labels?.reset ?? t('common.restoreDefault')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={submit}
          {...slot('submit', undefined, { testId: 'table-settings-submit' })}
        >
          {labels?.submit ?? t('common.apply')}
        </Button>
      </div>
    </Popover>
  );
}

function isSameSettings(a: TableColumnSettings, b: TableColumnSettings): boolean {
  const sameOrder =
    a.order.length === b.order.length && a.order.every((id, i) => b.order[i] === id);
  const sameHidden =
    a.hidden.length === b.hidden.length && a.hidden.every((id) => b.hidden.includes(id));
  return sameOrder && sameHidden;
}

interface SortableItemProps {
  id: string;
  label: string;
  visible: boolean;
  locked: boolean;
  /** 拖曳把手的無障礙名稱，含欄位名稱。 */
  dragLabel: string;
  onToggle: (id: string, visible: boolean) => void;
  slot: SlotResolver<TableSettingsSlot>;
}

function SortableItem({
  id,
  label,
  visible,
  locked,
  dragLabel,
  onToggle,
  slot,
}: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const itemAttributes = slot('item', styles.item, { testId: 'table-settings-item' });

  return (
    <li
      ref={setNodeRef}
      {...itemAttributes}
      // dnd-kit 算出的位移是連續值，只能用 inline style
      style={{
        ...itemAttributes.style,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      data-value={id}
      data-dragging={isDragging || undefined}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        {...slot('dragHandle', styles.dragHandle)}
        aria-label={dragLabel}
      >
        <Icon name="menu" size={14} />
      </button>
      <Checkbox
        label={label}
        checked={visible}
        disabled={locked}
        onCheckedChange={(checked) => onToggle(id, checked)}
        className={styles.checkbox}
      />
    </li>
  );
}

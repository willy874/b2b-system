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

import { Button, IconButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Select } from '@/components/Select';
import { useTranslation } from '@/core/locales';
import { isSortOrder, SortOrder } from '@/shared/constants';
import type { SortEntry, SortOrderType } from '@/shared/constants';

import { isSortEntries } from './filter-utils';
import type { FilterOption, SortFilterField } from './types';

import styles from './FilterBar.module.css';

interface SortControlProps {
  field: SortFilterField;
  /** 草稿裡的 `SortEntry[]`；外部型別由 `FilterField<TValues>` 保證，這裡只做執行期的防禦。 */
  value: unknown;
  onChange: (value: SortEntry[]) => void;
}

/**
 * 多欄排序的編輯器（參考 merak-client 的 SortField）：每列一個條件，
 * 列的順序就是優先順序，可以拖曳調整；同一欄位只能選一次。只改草稿，送出由 `FilterBar` 負責。
 */
export function SortControl({ field, value, onChange }: SortControlProps) {
  const { t } = useTranslation();
  const entries = isSortEntries(value) ? value : [];
  const used = new Set(entries.map((entry) => entry.sort));
  const labels = new Map(field.options.map((option) => [option.value, option.label]));
  const orderOptions = [
    { value: SortOrder.ASC, label: t('common.sortAsc') },
    { value: SortOrder.DESC, label: t('common.sortDesc') },
  ];
  const sensors = useSensors(
    // 移動一小段距離才開始拖曳，單純點擊把手不會被當成拖曳
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const update = (index: number, next: SortEntry) =>
    onChange(entries.map((entry, i) => (i === index ? next : entry)));

  const add = () => {
    const next = field.options.find((option) => !used.has(option.value));
    if (next) onChange([...entries, { sort: next.value, order: SortOrder.ASC }]);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = entries.findIndex((entry) => entry.sort === active.id);
    const to = entries.findIndex((entry) => entry.sort === over.id);
    if (from === -1 || to === -1) return;
    onChange(arrayMove(entries, from, to));
  };

  return (
    <div className={styles.sortControl}>
      {entries.length === 0 ? (
        <p className={styles.sortEmpty}>{t('common.sortEmpty')}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          {/* 同一欄位只出現一次，欄位名稱就能當拖曳的 id */}
          <SortableContext
            items={entries.map((entry) => entry.sort)}
            strategy={verticalListSortingStrategy}
          >
            <ol className={styles.sortList} aria-label={field.label}>
              {entries.map((entry, index) => {
                const label = labels.get(entry.sort) ?? entry.sort;
                return (
                  <SortRow
                    key={entry.sort}
                    index={index}
                    entry={entry}
                    // 自己目前的欄位 ＋ 還沒被其他列選走的欄位
                    fieldOptions={field.options.filter(
                      (option) => option.value === entry.sort || !used.has(option.value),
                    )}
                    orderOptions={orderOptions}
                    disabled={field.disabled}
                    dragLabel={t('common.dragToReorder', { name: label })}
                    removeLabel={t('common.removeSort', { name: label })}
                    fieldLabel={t('common.sortField', { index: index + 1 })}
                    orderLabel={t('common.sortDirection', { name: label })}
                    onChange={(next) => update(index, next)}
                    onRemove={() => onChange(entries.filter((_, i) => i !== index))}
                  />
                );
              })}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      <Button
        size="sm"
        variant="ghost"
        startIcon={<Icon name="plus" size={14} />}
        disabled={field.disabled || used.size >= field.options.length}
        onClick={add}
        data-testid="filter-bar-sort-add"
      >
        {t('common.addSort')}
      </Button>
    </div>
  );
}

interface SortRowProps {
  index: number;
  entry: SortEntry;
  fieldOptions: FilterOption[];
  orderOptions: Array<{ value: SortOrderType; label: string }>;
  disabled: boolean | undefined;
  dragLabel: string;
  removeLabel: string;
  fieldLabel: string;
  orderLabel: string;
  onChange: (next: SortEntry) => void;
  onRemove: () => void;
}

function SortRow({
  index,
  entry,
  fieldOptions,
  orderOptions,
  disabled,
  dragLabel,
  removeLabel,
  fieldLabel,
  orderLabel,
  onChange,
  onRemove,
}: SortRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.sort,
    disabled,
  });

  return (
    <li
      ref={setNodeRef}
      className={styles.sortRow}
      // dnd-kit 算出的位移是連續值，只能用 inline style
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="filter-bar-sort-row"
      data-value={entry.sort}
      data-dragging={isDragging || undefined}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className={styles.dragHandle}
        aria-label={dragLabel}
      >
        <Icon name="menu" size={14} />
      </button>
      <span className={styles.sortIndex} aria-hidden>
        {index + 1}
      </span>
      <Select
        size="sm"
        value={entry.sort}
        onValueChange={(sort) => onChange({ ...entry, sort })}
        options={fieldOptions}
        disabled={disabled}
        className={styles.sortField}
        aria-label={fieldLabel}
      />
      <Select
        size="sm"
        value={entry.order}
        onValueChange={(order) => {
          if (isSortOrder(order)) onChange({ ...entry, order });
        }}
        options={orderOptions}
        disabled={disabled}
        className={styles.sortOrder}
        aria-label={orderLabel}
      />
      <IconButton size="sm" aria-label={removeLabel} disabled={disabled} onClick={onRemove}>
        <Icon name="close" size={14} />
      </IconButton>
    </li>
  );
}

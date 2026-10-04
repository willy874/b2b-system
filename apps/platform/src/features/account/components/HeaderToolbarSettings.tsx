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

import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Switch } from '@/components/Switch';
import { useTranslation } from '@/core/locales';
import { useHeaderToolbarStore } from '@/core/store';
import { useHeaderTools } from '@/core/toolbar';
import type { ResolvedHeaderTool } from '@/core/toolbar';
import { cn } from '@/shared/utils';

/**
 * 偏好頁的「頂列工具」：拖曳調整順序、開關決定是否顯示，改了立即生效（只存本機）。
 * 列出的是 `core/toolbar` 登記過的工具，之後追加的工具不必改這裡。
 */
export function HeaderToolbarSettings() {
  const { t } = useTranslation();
  const tools = useHeaderTools();
  const customized = useHeaderToolbarStore((state) => state.settings !== null);
  const setSettings = useHeaderToolbarStore((state) => state.setSettings);
  const resetSettings = useHeaderToolbarStore((state) => state.resetSettings);
  const sensors = useSensors(
    // 移動一小段距離才開始拖曳，單純點擊把手不會被當成拖曳
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const order = tools.map(({ tool }) => tool.key);
  const hidden = tools.flatMap(({ tool, visible }) => (visible ? [] : [tool.key]));

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    setSettings({ order: arrayMove(order, from, to), hidden });
  };

  const toggle = (key: string, visible: boolean) => {
    setSettings({
      order,
      hidden: visible ? hidden.filter((item) => item !== key) : [...hidden, key],
    });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="header-toolbar-settings">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {tools.map((item) => (
              <SortableTool
                key={item.tool.key}
                item={item}
                label={t(item.tool.labelI18nKey)}
                onToggle={toggle}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {customized && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={resetSettings}
            data-testid="header-toolbar-reset"
          >
            {t('common.restoreDefault')}
          </Button>
        </div>
      )}
    </div>
  );
}

interface SortableToolProps {
  item: ResolvedHeaderTool;
  label: string;
  onToggle: (key: string, visible: boolean) => void;
}

function SortableTool({ item, label, onToggle }: SortableToolProps) {
  const { t } = useTranslation();
  const { key, icon } = item.tool;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: key,
  });

  return (
    <li
      ref={setNodeRef}
      // dnd-kit 算出的位移是連續值，只能用 inline style
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-md border border-solid border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5',
        isDragging && 'relative z-1 shadow-[var(--shadow-popover)]',
      )}
      data-testid="header-toolbar-item"
      data-value={key}
      data-hidden={!item.visible || undefined}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="inline-flex h-6 w-6 cursor-grab items-center justify-center rounded-sm border-0 bg-transparent p-0 text-[var(--color-fg-muted)] active:cursor-grabbing"
        aria-label={t('common.dragToReorder', { name: label })}
        data-testid="header-toolbar-drag"
      >
        <Icon name="menu" size={14} />
      </button>
      <Icon name={icon} size={16} />
      <span className={cn('flex-1', !item.visible && 'text-[var(--color-fg-muted)]')}>{label}</span>
      <Switch
        checked={item.visible}
        onCheckedChange={(checked) => onToggle(key, checked)}
        aria-label={t('account.preference.headerToolbarShow', { name: label })}
        data-testid="header-toolbar-toggle"
      />
    </li>
  );
}

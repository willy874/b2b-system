import { Chip } from '@b2b-system/ui/Chip';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';
import type { KeyboardEvent } from 'react';

import type { PermissionSourceGroup, PermissionSourceItem } from './permissionSourceModel';
import { isImpliedOnly } from './permissionSourceModel';

interface PermissionSourceListProps {
  groups: readonly PermissionSourceGroup[];
  selectedKey: string | undefined;
  /** 點一個權限，或以 ↑／↓ 移到它：由呼叫端顯示它的來源（`PermissionSourceViewer`）。 */
  onSelect: (item: PermissionSourceItem) => void;
  nameOf: (item: PermissionSourceItem) => string;
}

/** ↑／↓／Home／End 在列之間移動焦點並選取，右側的來源跟著換（`focus()` 會把列捲進可視範圍）。 */
function moveFocus(event: KeyboardEvent<HTMLButtonElement>, onSelect: (key: string) => void) {
  const list = event.currentTarget.closest('[data-testid="permission-source-list"]');
  if (!list) return;
  const rows = [...list.querySelectorAll<HTMLButtonElement>('[data-testid="permission-source"]')];
  const current = rows.indexOf(event.currentTarget);
  const next = {
    ArrowDown: Math.min(current + 1, rows.length - 1),
    ArrowUp: Math.max(current - 1, 0),
    Home: 0,
    End: rows.length - 1,
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  const row = rows[next];
  row?.focus();
  if (row?.dataset.value) onSelect(row.dataset.value);
}

/**
 * 有效權限的清單（docs/architecture/iam/08-explain.md §5）：依資源分組，每一列是權限名稱與鍵、來源數，
 * 只由依賴樹帶出的另外標示。過濾與分組由呼叫端做（`permissionSourceModel`）。
 */
export function PermissionSourceList({
  groups,
  selectedKey,
  onSelect,
  nameOf,
}: PermissionSourceListProps) {
  const { t } = useTranslation();
  const byKey = new Map(groups.flatMap((group) => group.items.map((item) => [item.key, item])));
  const selectByKey = (key: string) => {
    const item = byKey.get(key);
    if (item) onSelect(item);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="permission-source-list">
      {groups.map((group) => (
        <section key={group.resource} className="flex flex-col gap-0.5">
          <h3 className="m-0 flex items-baseline gap-1.5 px-2 text-xs font-medium text-[var(--color-fg-muted)]">
            {t(group.resourceNameI18nKey) || group.resource}
            <span className="font-normal">{group.items.length}</span>
          </h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {group.items.map((item) => {
              const isSelected = item.key === selectedKey;
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    onKeyDown={(event) => moveFocus(event, selectByKey)}
                    aria-current={isSelected || undefined}
                    className={cn(
                      'flex w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-md)] border-0 border-l-2 border-l-solid px-2 py-1.5 text-left text-[var(--color-fg)]',
                      // 同一個屬性的 utility 誰贏看 CSS 的輸出順序、不看 className 的順序：選中與否各自給完整的一組
                      isSelected && 'border-l-[var(--color-brand)] bg-[var(--color-fill)]',
                      !isSelected &&
                        'border-l-transparent bg-transparent hover:bg-[var(--color-fill-subtle)]',
                    )}
                    data-testid="permission-source"
                    data-value={item.key}
                    data-selected={isSelected || undefined}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm">{nameOf(item)}</span>
                      <code className="truncate font-mono text-xs text-[var(--color-fg-muted)]">
                        {item.key}
                      </code>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {isImpliedOnly(item) && <Chip>{t('explain.list.implied')}</Chip>}
                      <Chip>{t('explain.list.sources', { count: item.sources.length })}</Chip>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

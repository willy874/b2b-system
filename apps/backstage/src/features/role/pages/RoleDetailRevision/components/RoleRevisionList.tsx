import { Chip } from '@/components/Chip';
import { Pagination } from '@/components/Pagination';
import { useTranslation } from '@/core/locales';
import { cn } from '@/shared/utils';

import type { RoleRevisionRowVM } from '../adapter';

interface RoleRevisionListProps {
  rows: RoleRevisionRowVM[];
  selectedVersion: number | undefined;
  latestVersion: number | undefined;
  onSelect: (version: number) => void;
  offset: number;
  limit: number;
  total: number;
  onPageChange: (offset: number) => void;
}

/** 版本列表（新的在前）：版本號、作者、時間；最新一版標「目前」，過大未保存的標出來。 */
export function RoleRevisionList({
  rows,
  selectedVersion,
  latestVersion,
  onSelect,
  offset,
  limit,
  total,
  onPageChange,
}: RoleRevisionListProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={t('role.revision.list')}>
        {rows.map((row) => (
          <li key={row.version}>
            <button
              type="button"
              className={cn(
                'flex w-full flex-col gap-0.5 rounded border border-transparent bg-transparent px-3 py-2 text-start text-sm',
                row.version === selectedVersion &&
                  'border-[var(--color-brand)] bg-[var(--color-fill-subtle)]',
              )}
              aria-pressed={row.version === selectedVersion}
              onClick={() => onSelect(row.version)}
              data-testid="role-revision-item"
              data-value={row.version}
            >
              <span className="flex items-center gap-2 font-medium">
                {t('role.revision.version', { version: row.version })}
                {row.version === latestVersion && (
                  <Chip tone="brand">{t('role.revision.current')}</Chip>
                )}
                {row.tooLarge && <Chip tone="warning">{t('role.revision.tooLarge')}</Chip>}
              </span>
              <span className="text-xs text-[var(--color-fg-muted)]">
                {row.actorName ?? t('role.revision.system')} · {row.createdAt}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {total > limit && (
        <Pagination
          offset={offset}
          limit={limit}
          total={total}
          onChange={(next) => onPageChange(next.offset)}
        />
      )}
    </div>
  );
}

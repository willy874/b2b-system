import { Chip } from '@b2b-system/ui/Chip';
import { Input } from '@b2b-system/ui/Input';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useMemo, useState } from 'react';

import type { PermissionSources } from '@/shared/api-sdk';

import { ExplainPath } from './ExplainPath';

type PermissionSourceItem = PermissionSources['items'][number];

interface PermissionSourceListProps {
  data: PermissionSources;
  /** 點一個權限：由呼叫端打開它的來源（`PermissionSourceViewer`）。 */
  onSelect: (item: PermissionSourceItem) => void;
}

/** 依資源（權限鍵冒號前的部分）分組，組內照後端的順序。 */
function groupByResource(items: readonly PermissionSourceItem[]) {
  const groups = new Map<string, PermissionSourceItem[]>();
  for (const item of items) {
    const resource = item.key.slice(0, item.key.indexOf(':'));
    groups.set(resource, [...(groups.get(resource) ?? []), item]);
  }
  return [...groups];
}

/**
 * 有效權限的清單（docs/architecture/iam/01-model.md §9 G4b）：依資源分組、可以搜尋，每一列標出有幾個來源；
 * 點了才看路徑（`PermissionSourceViewer`），清單本身保持短、好掃讀。資料由呼叫端查（core 不碰 `apis/`）。
 */
export function PermissionSourceList({ data, onSelect }: PermissionSourceListProps) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  const groups = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return groupByResource(
      needle ? data.items.filter((item) => item.key.toLowerCase().includes(needle)) : data.items,
    );
  }, [data.items, keyword]);

  return (
    <div className="flex flex-col gap-3" data-testid="permission-source-list">
      {data.isSuperAdmin && (
        <div className="flex flex-col gap-1" data-testid="permission-source-super-admin">
          <p className="m-0 text-sm">{t('explain.superAdmin')}</p>
          {data.superAdminVia && <ExplainPath nodes={data.superAdminVia} />}
        </div>
      )}
      {data.items.length === 0 && !data.isSuperAdmin ? (
        <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('explain.noPermissions')}</p>
      ) : (
        <>
          <Input
            size="sm"
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t('explain.list.search')}
            aria-label={t('explain.list.search')}
            data-testid="permission-source-search"
          />
          {groups.length === 0 && (
            <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('explain.list.noMatch')}</p>
          )}
          {groups.map(([resource, items]) => (
            <section key={resource} className="flex flex-col gap-1">
              <h3 className="m-0 font-mono text-xs font-medium text-[var(--color-fg-muted)]">
                {resource}
              </h3>
              <ul className="m-0 flex list-none flex-col p-0">
                {items.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => onSelect(item)}
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-md)] border-0 bg-transparent px-2 py-1.5 text-left text-[var(--color-fg)] hover:bg-[var(--color-fill-subtle)]"
                      data-testid="permission-source"
                      data-value={item.key}
                    >
                      <code className="font-mono text-xs font-medium">{item.key}</code>
                      <Chip>{t('explain.list.sources', { count: item.sources.length })}</Chip>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

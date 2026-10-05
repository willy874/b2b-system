import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Input } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useState } from 'react';

import type { PermissionCatalog } from '@/shared/api-sdk';

import { hasPermissionFilters } from '../../../hooks/permissionCatalogFilter';
import { PERMISSION_HELD_FILTERS } from '../../../routes';
import type { PermissionFilters, PermissionHeldFilter } from '../../../routes';

export interface PermissionCatalogFilterProps {
  catalog: PermissionCatalog;
  filters: PermissionFilters;
  /** 符合條件的權限數。 */
  matched: number;
  onChange: (filters: PermissionFilters, replace?: boolean) => void;
  onReset: () => void;
}

const HELD_LABEL_KEY = {
  held: 'permissionCatalog.held',
  notHeld: 'permissionCatalog.notHeld',
} as const satisfies Record<PermissionHeldFilter, string>;

/** 「全部」在下拉選單裡的值；寫進網址時換回 `undefined`。 */
const ALL = 'all';

/** 篩選列：關鍵字（名稱或權限鍵）、資源（可複選）、是否持有。一覽表與樹狀圖共用。 */
export function PermissionCatalogFilter({
  catalog,
  filters,
  matched,
  onChange,
  onReset,
}: PermissionCatalogFilterProps) {
  const { t } = useTranslation();
  // 輸入框自己保留打字中的值（含尾端空白）；網址被外部改掉（清除篩選、上一頁）時才跟上
  const [keyword, setKeyword] = useState(filters.keyword ?? '');
  const [syncedKeyword, setSyncedKeyword] = useState(filters.keyword);
  if (syncedKeyword !== filters.keyword) {
    setSyncedKeyword(filters.keyword);
    if ((keyword.trim() || undefined) !== filters.keyword) setKeyword(filters.keyword ?? '');
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="permission-filter">
      <Input
        type="search"
        size="sm"
        className="w-full sm:w-60"
        value={keyword}
        placeholder={t('permissionCatalog.filter.keyword')}
        aria-label={t('permissionCatalog.filter.keyword')}
        onChange={(event) => {
          setKeyword(event.target.value);
          onChange({ ...filters, keyword: event.target.value.trim() || undefined }, true);
        }}
        data-testid="permission-filter-keyword"
      />
      <Select
        multiple
        size="sm"
        className="w-full sm:w-56"
        options={catalog.groups.map((group) => ({
          value: group.resource,
          label: t(group.nameI18nKey),
        }))}
        value={filters.resource ?? []}
        onValueChange={(resource) =>
          onChange({ ...filters, resource: resource.length > 0 ? resource : undefined })
        }
        placeholder={t('permissionCatalog.filter.allResources')}
        aria-label={t('permissionCatalog.filter.resource')}
        data-testid="permission-filter-resource"
      />
      <Select
        size="sm"
        className="w-full sm:w-40"
        options={[
          { value: ALL, label: t('permissionCatalog.filter.allHeld') },
          ...PERMISSION_HELD_FILTERS.map((held) => ({
            value: held,
            label: t(HELD_LABEL_KEY[held]),
          })),
        ]}
        value={filters.held ?? ALL}
        onValueChange={(held) =>
          onChange({ ...filters, held: held === ALL ? undefined : (held as PermissionHeldFilter) })
        }
        aria-label={t('permissionCatalog.filter.held')}
        data-testid="permission-filter-held"
      />
      {hasPermissionFilters(filters) && (
        <Button
          variant="ghost"
          size="sm"
          startIcon={<Icon name="close" size={14} />}
          onClick={onReset}
          data-testid="permission-filter-reset"
        >
          {t('permissionCatalog.filter.reset')}
        </Button>
      )}
      <output
        className="ms-auto text-xs text-[var(--color-fg-muted)]"
        data-testid="permission-filter-count"
      >
        {t('permissionCatalog.filter.count', { matched, total: catalog.items.length })}
      </output>
    </div>
  );
}

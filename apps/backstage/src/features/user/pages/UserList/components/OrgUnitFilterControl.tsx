import { Checkbox } from '@b2b-system/ui/Checkbox';
import { useTranslation } from '@b2b-system/web-core/locales';

import { OrgUnitPicker } from '@/core/components/OrgUnitPicker';
import type { OrgUnit } from '@/shared/api-sdk';

/** 篩選面板裡的部門條件；`undefined` = 不篩選。 */
export interface OrgUnitFilterValue {
  unitId: string;
  /** 含下層部門 */
  includeDescendants: boolean;
}

interface OrgUnitFilterControlProps {
  units: readonly OrgUnit[] | undefined;
  loading: boolean;
  value: OrgUnitFilterValue | undefined;
  onChange: (value: OrgUnitFilterValue | undefined) => void;
}

/** 使用者列表的部門篩選：部門選擇器 ＋「含下層部門」（docs/architecture/backend/23-organization.md §8）。 */
export function OrgUnitFilterControl({
  units,
  loading,
  value,
  onChange,
}: OrgUnitFilterControlProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <OrgUnitPicker
        size="sm"
        units={units}
        loading={loading}
        value={value?.unitId ?? null}
        onChange={(unitId) =>
          onChange(
            unitId ? { unitId, includeDescendants: value?.includeDescendants ?? false } : undefined,
          )
        }
        noneLabel={t('user.orgUnit.all')}
        aria-label={t('user.orgUnit.filter')}
        searchPlaceholder={t('user.orgUnit.searchPlaceholder')}
        noMatchLabel={t('user.orgUnit.noMatch')}
        data-testid="user-org-unit-filter"
      />
      <Checkbox
        checked={value?.includeDescendants ?? false}
        disabled={!value}
        onCheckedChange={(checked) => value && onChange({ ...value, includeDescendants: checked })}
        label={t('user.orgUnit.includeDescendants')}
        data-testid="user-org-unit-filter-descendants"
      />
    </div>
  );
}

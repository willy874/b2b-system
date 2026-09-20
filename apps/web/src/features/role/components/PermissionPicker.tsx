import { Checkbox } from '@/components/Checkbox';
import { Tooltip } from '@/components/Tooltip';
import { useTranslation } from '@/core/locales';

import { useGrantablePermissions } from '../hooks/useGrantablePermissions';

export interface PermissionPickerProps {
  selected: Set<string>;
  onToggle: (key: string, checked: boolean) => void;
  disabled?: boolean;
  'data-testid'?: string;
}

/**
 * 反提權：未持有的權限顯示為 disabled ＋ tooltip，不隱藏——
 * 隱藏會讓管理員以為系統沒有這個權限。
 */
export function PermissionPicker({ selected, onToggle, disabled, ...rest }: PermissionPickerProps) {
  const { t } = useTranslation();
  const { groups, items, isGrantable, loading } = useGrantablePermissions();

  if (loading) return <p className="text-sm text-[var(--color-fg-muted)]">{t('common.loading')}</p>;

  return (
    <div className="flex flex-col gap-4" {...rest}>
      {groups.map((group) => (
        <fieldset
          key={group.resource}
          className="m-0 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"
        >
          <legend className="px-1 text-sm font-medium">{t(group.nameI18nKey)}</legend>
          <div className="flex flex-col gap-2">
            {group.keys.map((key) => {
              const item = items.find((permission) => permission.key === key);
              const grantable = isGrantable(key);
              return (
                <Tooltip key={key} content={grantable ? '' : t('role.permission.notGrantable')}>
                  <span>
                    <Checkbox
                      checked={selected.has(key)}
                      disabled={disabled || !grantable}
                      onCheckedChange={(checked) => onToggle(key, checked)}
                      label={item ? t(item.nameI18nKey) : key}
                      description={key}
                      data-testid={`permission-checkbox-${key}`}
                    />
                  </span>
                </Tooltip>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

import { Checkbox } from '@/components/Checkbox';
import { useTranslation } from '@/core/locales';
import type { PermissionScope } from '@/shared/api-sdk';

import { useGrantablePermissions } from '../hooks/useGrantablePermissions';

export interface PermissionPickerProps {
  /** 角色的範圍：只列同範圍的權限鍵。 */
  scope: PermissionScope;
  selected: Set<string>;
  onToggle: (key: string, checked: boolean) => void;
  disabled?: boolean;
  'data-testid'?: string;
}

/**
 * 反提權：未持有的權限顯示為 disabled ＋ 說明，不隱藏——
 * 隱藏會讓管理員以為系統沒有這個權限。
 */
export function PermissionPicker({
  scope,
  selected,
  onToggle,
  disabled,
  ...rest
}: PermissionPickerProps) {
  const { t } = useTranslation();
  const { groups, items, isGrantable, loading } = useGrantablePermissions(scope);

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
                <Checkbox
                  key={key}
                  checked={selected.has(key)}
                  disabled={disabled || !grantable}
                  onCheckedChange={(checked) => onToggle(key, checked)}
                  label={item ? t(item.nameI18nKey) : key}
                  /*
                   * Base UI 的 Checkbox 沒有 focusableWhenDisabled，停用後就聚焦不到，
                   * 所以「不可授予」的理由不能只放在 hover 才出現的 Tooltip 裡。
                   * 改成常駐的 description——它在 <label> 內，會跟著一起被念出來。
                   */
                  description={grantable ? key : `${key} · ${t('role.permission.notGrantable')}`}
                  data-testid="permission-checkbox"
                  data-value={key}
                />
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

import { Select } from '@b2b-system/ui/Select';
import type { SelectOption } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useMemo } from 'react';

import type { Role } from '@/shared/api-sdk';

import { MAX_SERVICE_ACCOUNT_ROLES } from '../constants';

interface ServiceAccountRoleSelectProps {
  /** 可指派的角色選項（需要 role:read）；還沒載入時是 `undefined`。 */
  roles: Role[] | undefined;
  value: string[];
  onValueChange: (roleIds: string[]) => void;
  'aria-label'?: string;
  'data-testid'?: string;
}

/** 服務帳號持有的角色：可搜尋的多選，選滿上限後其餘選項停用（與使用者的角色選擇相同）。 */
export function ServiceAccountRoleSelect({
  roles,
  value,
  onValueChange,
  ...rest
}: ServiceAccountRoleSelectProps) {
  const { t } = useTranslation();
  const isFull = value.length >= MAX_SERVICE_ACCOUNT_ROLES;
  const options = useMemo<Array<SelectOption>>(() => {
    const selected = new Set(value);
    return (roles ?? []).map((role) => ({
      value: role.id,
      label: role.name,
      textValue: `${role.name} ${role.slug}`,
      description: role.slug,
      disabled: isFull && !selected.has(role.id),
    }));
  }, [roles, value, isFull]);

  return (
    <Select
      multiple
      searchable
      valueOrder="options"
      value={value}
      onValueChange={onValueChange}
      options={options}
      itemSize={48}
      placeholder={t('serviceAccount.role.placeholder')}
      searchPlaceholder={t('common.search')}
      {...rest}
    />
  );
}

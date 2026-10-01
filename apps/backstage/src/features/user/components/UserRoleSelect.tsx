import { useMemo } from 'react';

import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { useTranslation } from '@/core/locales';
import type { Role } from '@/shared/api-sdk';

/**
 * 一位使用者一次最多指派幾個角色；與後端一致
 * （apps/api/src/modules/user/dto/create-user.dto.ts、update-user.dto.ts 的 `roleIds.max(20)`）。
 */
export const MAX_USER_ROLES = 20;

interface UserRoleSelectProps {
  /** 可指派的角色選項（需要 role:read）；還沒載入時是 `undefined`。 */
  roles: Role[] | undefined;
  value: string[];
  onValueChange: (roleIds: string[]) => void;
  invalid?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
}

/** 指派給使用者的角色：可搜尋的多選下拉，選滿上限後其餘選項停用，而不是送出後才被拒絕。 */
export function UserRoleSelect({ roles, value, onValueChange, ...rest }: UserRoleSelectProps) {
  const { t } = useTranslation();
  const isFull = value.length >= MAX_USER_ROLES;
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
      placeholder={t('user.assignRole.placeholder')}
      searchPlaceholder={t('common.search')}
      {...rest}
    />
  );
}

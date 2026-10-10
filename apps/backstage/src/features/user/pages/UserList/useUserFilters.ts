import type { FilterBarProps } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { createElement } from 'react';

import type { OrgUnit, Role, Tag } from '@/shared/api-sdk';

import { USER_STATUS_LABEL_KEY } from '../../constants';
import type { UserSearchQuery } from '../../routes';
import { OrgUnitFilterControl } from './components/OrgUnitFilterControl';
import type { OrgUnitFilterValue } from './components/OrgUnitFilterControl';
import type { useUserSearchFilter } from './useUserSearchFilter';

export type UserFilterValues = Pick<
  UserSearchQuery,
  'keyword' | 'status' | 'mfa' | 'roleId' | 'includeGroupRoles' | 'tagId' | 'sort'
> & {
  /** 部門與「含下層部門」：網址上是 `orgUnitId`、`includeDescendants` 兩個參數，面板裡是一個欄位。 */
  orgUnit?: OrgUnitFilterValue;
};

const EMPTY_FILTERS: UserFilterValues = {
  keyword: undefined,
  status: undefined,
  mfa: undefined,
  roleId: undefined,
  includeGroupRoles: undefined,
  tagId: undefined,
  orgUnit: undefined,
  sort: [],
};

/** 部門篩選的資料；`undefined` = 不提供部門篩選（租戶沒有啟用 `organization` 或沒有 `orgUnit:read`）。 */
export interface UserOrgUnitFilterSource {
  units: readonly OrgUnit[] | undefined;
  loading: boolean;
}

/** 篩選面板：關鍵字、狀態、MFA、角色、標籤、部門、多欄排序。送出時一次寫進網址（`useUserSearchFilter`）。 */
export function useUserFilters(
  { search, setFilters }: ReturnType<typeof useUserSearchFilter>,
  /** `user` 標籤組的標籤；還沒載入或沒有任何標籤時不顯示標籤篩選。 */
  tags: readonly Tag[] = [],
  orgUnits?: UserOrgUnitFilterSource,
  /** 角色的選項；`undefined` = 不提供角色篩選（沒有 `role:read`）。 */
  roles?: readonly Role[],
): FilterBarProps<UserFilterValues> {
  const { t } = useTranslation();
  return {
    value: {
      keyword: search.keyword,
      status: search.status,
      mfa: search.mfa,
      roleId: search.roleId,
      includeGroupRoles: search.includeGroupRoles,
      tagId: search.tagId,
      orgUnit:
        orgUnits && search.orgUnitId
          ? { unitId: search.orgUnitId, includeDescendants: search.includeDescendants === 'true' }
          : undefined,
      sort: search.sort,
    },
    defaultValue: EMPTY_FILTERS,
    // 排序條件全部移除＝不指定，由後端套用預設排序。
    // 關鍵字改由表格上方常駐的搜尋框輸入，仍保留在 value 裡：面板送出與「清除篩選」時一起處理
    onSubmit: ({ orgUnit, ...rest }) =>
      setFilters({
        ...rest,
        orgUnitId: orgUnit?.unitId,
        includeDescendants: orgUnit?.includeDescendants ? 'true' : undefined,
      }),
    fields: [
      {
        type: 'select',
        key: 'status',
        label: t('user.field.status'),
        allLabel: t('user.status.all'),
        options: [
          { value: 'active', label: t(USER_STATUS_LABEL_KEY.active) },
          { value: 'pending', label: t(USER_STATUS_LABEL_KEY.pending) },
          { value: 'inactive', label: t(USER_STATUS_LABEL_KEY.inactive) },
          { value: 'locked', label: t(USER_STATUS_LABEL_KEY.locked) },
        ],
      },
      {
        type: 'select',
        key: 'mfa',
        label: t('user.field.mfa'),
        allLabel: t('user.mfa.all'),
        options: [
          { value: 'true', label: t('user.mfa.enabled') },
          { value: 'false', label: t('user.mfa.disabled') },
        ],
      },
      ...(roles
        ? [
            {
              type: 'multiSelect' as const,
              key: 'roleId' as const,
              label: t('user.filter.role'),
              options: roles.map((role) => ({ value: role.id, label: role.name })),
            },
            {
              type: 'select' as const,
              key: 'includeGroupRoles' as const,
              label: t('user.filter.roleSource'),
              allLabel: t('user.filter.roleSourceDirect'),
              options: [
                { value: 'true' as const, label: t('user.filter.roleSourceIncludeGroups') },
              ],
            },
          ]
        : []),
      ...(tags.length
        ? [
            {
              type: 'multiSelect' as const,
              key: 'tagId' as const,
              label: t('tag.filter'),
              options: tags.map((tag) => ({ value: tag.id, label: tag.name })),
            },
          ]
        : []),
      ...(orgUnits
        ? [
            {
              type: 'custom' as const,
              key: 'orgUnit' as const,
              label: t('user.orgUnit.filter'),
              render: ({
                value,
                onChange,
              }: {
                value: OrgUnitFilterValue | undefined;
                onChange: (value: OrgUnitFilterValue | undefined) => void;
              }) =>
                createElement(OrgUnitFilterControl, {
                  units: orgUnits.units,
                  loading: orgUnits.loading,
                  value,
                  onChange,
                }),
            },
          ]
        : []),
      {
        type: 'sort',
        key: 'sort',
        label: t('common.sort'),
        options: [
          { value: 'createdAt', label: t('user.field.createdAt') },
          { value: 'displayName', label: t('user.field.displayName') },
          { value: 'email', label: t('user.field.email') },
          { value: 'lastLoginAt', label: t('user.field.lastLoginAt') },
        ],
      },
    ],
  };
}

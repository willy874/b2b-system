import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getUserListQueryOptions } from '@/apis/user/get-user-list/query';
import { Select } from '@/components/Select';
import { useTranslation } from '@/core/locales';

interface UserPickerProps {
  value: string | null;
  onChange: (userId: string) => void;
  invalid?: boolean;
}

/** 以名稱或 email 搜尋使用者（平台管理員持有 `user:read`）。 */
export function UserPicker({ value, onChange, invalid }: UserPickerProps) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  const { data, isFetching } = useQuery({
    ...getUserListQueryOptions({
      params: { offset: 0, limit: 20, keyword: keyword || undefined, status: ['active'] },
    }),
    placeholderData: keepPreviousData,
  });
  const options = (data?.items ?? []).map((user) => ({
    value: user.id,
    label: user.displayName,
    description: user.email,
    textValue: `${user.displayName} ${user.email}`,
  }));

  return (
    <Select
      options={options}
      value={value}
      onValueChange={onChange}
      searchable
      filterOption={false}
      onSearchChange={setKeyword}
      loading={isFetching}
      itemSize={48}
      invalid={invalid}
      placeholder={t('workspace.admin.userPlaceholder')}
      data-testid="workspace-admin-user-picker"
    />
  );
}

import { Select } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getUserListQueryOptions } from '@/apis/user/get-user-list/query';

/** 輸入停頓多久才查詢（與群組成員的搜尋相同）。 */
const USER_SEARCH_DEBOUNCE_MS = 250;

interface UserSearchSelectProps {
  value: string | null;
  onChange: (value: string) => void;
  /** 目前的值不在搜尋結果裡時顯示的名稱（例：已儲存的規則的顯示名稱）。 */
  selectedLabel?: string;
  /** 讀不到使用者（沒有 `user:read`）時停用，只顯示目前的值。 */
  disabled?: boolean;
  invalid?: boolean;
  'aria-label': string;
  'data-testid'?: string;
}

/** 伺服器端搜尋使用者（使用者可能很多，不一次載入）。 */
export function UserSearchSelect({
  value,
  onChange,
  selectedLabel,
  disabled,
  invalid,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: UserSearchSelectProps) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(keyword.trim()), USER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keyword]);

  const users = useQuery({
    ...getUserListQueryOptions({
      params: { offset: 0, limit: 20, keyword: debounced || undefined },
    }),
    enabled: !disabled,
  });
  const options = (users.data?.items ?? []).map((user) => ({
    value: user.id,
    label: user.displayName,
    description: user.email,
  }));
  if (value && !options.some((option) => option.value === value)) {
    options.unshift({ value, label: selectedLabel || value, description: '' });
  }

  return (
    <Select
      aria-label={ariaLabel}
      placeholder={t('approvalFlow.assignee.userPlaceholder')}
      options={options}
      value={value}
      onValueChange={onChange}
      searchable
      searchValue={keyword}
      onSearchChange={setKeyword}
      filterOption={false}
      noMatchLabel={t('approvalFlow.assignee.noMatch')}
      loading={users.isFetching}
      disabled={disabled}
      invalid={invalid}
      itemSize={48}
      data-testid={testId}
    />
  );
}

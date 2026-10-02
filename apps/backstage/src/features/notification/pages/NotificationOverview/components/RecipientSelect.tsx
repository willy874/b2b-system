import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getUserDetailQueryOptions } from '@/apis/user/get-user-detail/query';
import { getUserListQueryOptions } from '@/apis/user/get-user-list/query';
import { Select } from '@/components/Select';
import { useTranslation } from '@/core/locales';

/** 輸入停頓多久才查詢（與群組成員的搜尋相同）。 */
const USER_SEARCH_DEBOUNCE_MS = 250;

interface RecipientSelectProps {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

/**
 * 篩選面板裡的收件人：在伺服器端搜尋使用者（`notification:read` 依賴 `user:read`）。
 * 從網址帶進來的收件人不在搜尋結果裡時，另外取那個人的名稱，選單才顯示得出目前的值。
 * 取消篩選用面板的「清除」或條件 Chip 的移除。
 */
export function RecipientSelect({ value, onChange }: RecipientSelectProps) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(keyword.trim()), USER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keyword]);

  const users = useQuery(
    getUserListQueryOptions({ params: { offset: 0, limit: 20, keyword: debounced || undefined } }),
  );
  const options = (users.data?.items ?? []).map((user) => ({
    value: user.id,
    label: user.displayName,
    description: user.email,
  }));
  const isSelectedListed = !value || options.some((option) => option.value === value);
  const selected = useQuery({
    ...getUserDetailQueryOptions(value ?? ''),
    enabled: !isSelectedListed,
  });
  if (!isSelectedListed && selected.data) {
    options.unshift({
      value: selected.data.id,
      label: selected.data.displayName,
      description: selected.data.email,
    });
  }

  return (
    <Select
      aria-label={t('notification.overview.field.recipient')}
      placeholder={t('notification.overview.filter.anyRecipient')}
      options={options}
      value={value ?? null}
      onValueChange={onChange}
      searchable
      searchValue={keyword}
      onSearchChange={setKeyword}
      filterOption={false}
      noMatchLabel={t('notification.overview.filter.noRecipient')}
      loading={users.isFetching}
      data-testid="notification-overview-recipient"
    />
  );
}

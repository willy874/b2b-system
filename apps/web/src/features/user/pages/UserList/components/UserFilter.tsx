import { useState } from 'react';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { useTranslation } from '@/core/locales';

import type { UserSearchQuery } from '../../../routes';

interface UserFilterProps {
  search: UserSearchQuery;
  onKeywordChange: (keyword: string) => void;
  onStatusChange: (status: UserSearchQuery['status']) => void;
}

/** 關鍵字（按 Enter 或搜尋鈕才送出）＋ 狀態篩選。 */
export function UserFilter({ search, onKeywordChange, onStatusChange }: UserFilterProps) {
  const { t } = useTranslation();
  const [keywordDraft, setKeywordDraft] = useState(search.keyword ?? '');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder={t('user.list.searchPlaceholder')}
        value={keywordDraft}
        onChange={(event) => setKeywordDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onKeywordChange(keywordDraft);
        }}
        className="max-w-xs"
        data-testid="user-search-input"
      />
      <Select
        value={search.status ?? 'all'}
        onValueChange={(value) =>
          onStatusChange(value === 'all' ? undefined : (value as UserSearchQuery['status']))
        }
        options={[
          { value: 'all', label: t('user.status.all') },
          { value: 'active', label: t('user.status.active') },
          { value: 'pending', label: t('user.status.pending') },
          { value: 'inactive', label: t('user.status.inactive') },
          { value: 'locked', label: t('user.status.locked') },
        ]}
        className="w-40"
        aria-label={t('user.field.status')}
      />
      <Button onClick={() => onKeywordChange(keywordDraft)}>{t('common.search')}</Button>
    </div>
  );
}

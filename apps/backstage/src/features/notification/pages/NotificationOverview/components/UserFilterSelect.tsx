import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getUserDetailQueryOptions } from '@/apis/user/get-user-detail/query';
import { getUserSearchQueryOptions } from '@/apis/user/get-user-list/query';
import { UserSearchSelect } from '@/core/components/UserSearchSelect';

interface UserFilterSelectProps {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  /** 欄位名稱（收件人、觸發者）。 */
  label: string;
  /** 沒有選人時的文字（所有收件人、所有觸發者）。 */
  placeholder: string;
  /** 完整字面量（docs/coding-standards/06-literal-strings.md §3.3）。 */
  'data-testid': string;
}

/**
 * 篩選面板裡的收件人、觸發者：在伺服器端搜尋使用者（`notification:read` 依賴 `user:read`）。
 * 從網址帶進來的使用者另外取名稱，選單才顯示得出目前的值。取消篩選用面板的「清除」或條件 Chip 的移除。
 */
export function UserFilterSelect({
  value,
  onChange,
  label,
  placeholder,
  'data-testid': testId,
}: UserFilterSelectProps) {
  const { t } = useTranslation();
  const selected = useQuery({ ...getUserDetailQueryOptions(value ?? ''), enabled: Boolean(value) });

  return (
    <UserSearchSelect
      query={getUserSearchQueryOptions}
      selected={value && selected.data ? [selected.data] : undefined}
      aria-label={label}
      placeholder={placeholder}
      value={value ?? null}
      onValueChange={onChange}
      noMatchLabel={t('notification.overview.filter.noRecipient')}
      data-testid={testId}
    />
  );
}

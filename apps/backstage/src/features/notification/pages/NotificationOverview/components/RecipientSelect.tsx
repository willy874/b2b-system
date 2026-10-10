import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getUserDetailQueryOptions } from '@/apis/user/get-user-detail/query';
import { getUserSearchQueryOptions } from '@/apis/user/get-user-list/query';
import { UserSearchSelect } from '@/core/components/UserSearchSelect';

interface RecipientSelectProps {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

/**
 * 篩選面板裡的收件人：在伺服器端搜尋使用者（`notification:read` 依賴 `user:read`）。
 * 從網址帶進來的收件人另外取名稱，選單才顯示得出目前的值。取消篩選用面板的「清除」或條件 Chip 的移除。
 */
export function RecipientSelect({ value, onChange }: RecipientSelectProps) {
  const { t } = useTranslation();
  const selected = useQuery({ ...getUserDetailQueryOptions(value ?? ''), enabled: Boolean(value) });

  return (
    <UserSearchSelect
      query={getUserSearchQueryOptions}
      selected={value && selected.data ? [selected.data] : undefined}
      aria-label={t('notification.overview.field.recipient')}
      placeholder={t('notification.overview.filter.anyRecipient')}
      value={value ?? null}
      onValueChange={onChange}
      noMatchLabel={t('notification.overview.filter.noRecipient')}
      data-testid="notification-overview-recipient"
    />
  );
}

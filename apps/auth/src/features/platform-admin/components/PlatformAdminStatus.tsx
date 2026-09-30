import { useTranslation } from '@/core/locales';
import type { PlatformAdmin } from '@/shared/api-sdk';
import { cn } from '@/shared/utils';

import { PLATFORM_ADMIN_STATUS_DOT_CLASS, PLATFORM_ADMIN_STATUS_LABEL_KEY } from '../constants';

export function PlatformAdminStatus({ status }: { status: PlatformAdmin['status'] }) {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm"
      data-testid="platform-admin-status"
      data-value={status}
    >
      <span
        className={cn('inline-block h-2 w-2 rounded-full', PLATFORM_ADMIN_STATUS_DOT_CLASS[status])}
        aria-hidden
      />
      {t(PLATFORM_ADMIN_STATUS_LABEL_KEY[status])}
    </span>
  );
}

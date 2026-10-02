import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getUserPermissionSourcesQueryOptions } from '@/apis/user/get-user-permission-sources/query';
import { Button } from '@/components/Button';
import { Spinner } from '@/components/Spinner';
import { PermissionSourceList, QueryError } from '@/core/components';
import { useTranslation } from '@/core/locales';

interface ProfilePermissionSectionProps {
  userId: string;
}

/**
 * 自己的有效權限與來源（docs/rbac/01-domain-model.md §9 G4b）：查自己不需要任何權限，所以沒有 `user:read` 的人也從這裡看得到。
 * 讀不到的群組與角色只顯示種類（D14）。展開時才查。
 */
export function ProfilePermissionSection({ userId }: ProfilePermissionSectionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sources = useQuery({ ...getUserPermissionSourcesQueryOptions(userId), enabled: open });

  return (
    <section className="flex flex-col gap-2" data-testid="profile-permission-sources">
      <h2 className="m-0 text-base font-medium">{t('account.profile.effective')}</h2>
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">
        {t('account.profile.effectiveHint')}
      </p>
      <div>
        {!open ? (
          <Button
            size="sm"
            onClick={() => setOpen(true)}
            data-testid="profile-permission-sources-show"
          >
            {t('account.profile.showEffective')}
          </Button>
        ) : sources.isPending ? (
          <Spinner size={16} />
        ) : sources.isError ? (
          <QueryError error={sources.error} onRetry={() => void sources.refetch()} />
        ) : (
          <PermissionSourceList data={sources.data} />
        )}
      </div>
    </section>
  );
}

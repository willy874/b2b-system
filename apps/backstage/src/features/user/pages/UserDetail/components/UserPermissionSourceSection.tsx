import { Button } from '@b2b-system/ui/Button';
import { Spinner } from '@b2b-system/ui/Spinner';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getUserPermissionSourcesQueryOptions } from '@/apis/user/get-user-permission-sources/query';
import { PermissionSourceList } from '@/core/components';

interface UserPermissionSourceSectionProps {
  userId: string;
}

/**
 * 有效權限與每個權限的來源（docs/rbac/01-domain-model.md §9 G4b）。看自己不需要權限，看別人要 `authz:explain`（呼叫端決定是否顯示）。
 * 內容多，展開時才查。
 */
export function UserPermissionSourceSection({ userId }: UserPermissionSourceSectionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sources = useQuery({ ...getUserPermissionSourcesQueryOptions(userId), enabled: open });

  return (
    <section data-testid="user-permission-sources">
      <h3 className="m-0 text-sm font-semibold">{t('user.detail.effective')}</h3>
      <p className="mt-1 text-xs text-[var(--color-fg-muted)]">{t('user.detail.effectiveHint')}</p>
      <div className="mt-2">
        {!open ? (
          <Button
            size="sm"
            onClick={() => setOpen(true)}
            data-testid="user-permission-sources-show"
          >
            {t('user.detail.showEffective')}
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

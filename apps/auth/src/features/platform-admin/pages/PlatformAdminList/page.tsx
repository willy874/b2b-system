import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getAdminListQueryOptions } from '@/apis/platform-admin/get-admin-list/query';
import { AlertDialog } from '@/components/AlertDialog';
import { Button } from '@/components/Button';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';

import { useSendPlatformAdminPasswordLinkMutation } from '../../hooks/usePlatformAdminMutations';
import { usePlatformAdminPermission } from '../../hooks/usePlatformAdminPermission';
import { matchesPlatformAdminKeyword, toPlatformAdminRowVM } from './adapter';
import type { PlatformAdminRowVM } from './adapter';
import { CreatePlatformAdminDialog } from './components/CreatePlatformAdminDialog';
import { EditPlatformAdminDialog } from './components/EditPlatformAdminDialog';
import { PlatformAdminTable } from './components/PlatformAdminTable';
import { usePlatformAdminSearchFilter } from './usePlatformAdminSearchFilter';

/**
 * 平台管理者清單（docs/architecture/05-tenancy.md §10.2 D5）：
 * 新增（寄啟用信）、編輯名稱／角色／狀態、寄設定密碼的連結。不能變更自己的角色與狀態。
 */
export default function PlatformAdminListPage() {
  const { t } = useTranslation();
  const permission = usePlatformAdminPermission();
  const showError = useErrorToast();
  const { search, setKeyword } = usePlatformAdminSearchFilter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlatformAdminRowVM>();
  const [sendingLinkTo, setSendingLinkTo] = useState<PlatformAdminRowVM>();
  const { data, isPending, error, refetch } = useQuery(getAdminListQueryOptions());
  const { data: profile } = useQuery(getAuthProfileQueryOptions());
  const sendLink = useSendPlatformAdminPasswordLinkMutation();
  const selfId = profile?.admin.id;

  const rows = useMemo(
    () =>
      (data?.items ?? [])
        .map((admin) => toPlatformAdminRowVM(admin, selfId))
        .filter((row) => matchesPlatformAdminKeyword(row, search.keyword)),
    [data, search.keyword, selfId],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="platform-admin-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('platformAdmin.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            {t('platformAdmin.description')}
          </p>
        </div>
        {permission.canCreate && (
          <Button
            variant="primary"
            onClick={() => setCreating(true)}
            data-testid="platform-admin-create-button"
          >
            {t('platformAdmin.create.action')}
          </Button>
        )}
      </header>

      <PlatformAdminTable
        rows={rows}
        loading={isPending}
        canUpdate={permission.canUpdate}
        onEdit={setEditing}
        onSendPasswordLink={setSendingLinkTo}
        searchBox={{
          value: search.keyword,
          onChange: setKeyword,
          placeholder: t('platformAdmin.searchPlaceholder'),
        }}
        error={error}
        onRetry={() => void refetch()}
      />

      <CreatePlatformAdminDialog open={creating} onClose={() => setCreating(false)} />
      {editing && (
        <EditPlatformAdminDialog
          key={editing.id}
          admin={editing}
          isSelf={editing.isSelf}
          onClose={() => setEditing(undefined)}
        />
      )}
      <AlertDialog
        open={sendingLinkTo !== undefined}
        onOpenChange={(open) => !open && setSendingLinkTo(undefined)}
        title={t('platformAdmin.passwordLink.title')}
        description={t('platformAdmin.passwordLink.confirm', { email: sendingLinkTo?.email })}
        confirmLabel={t('platformAdmin.passwordLink.send')}
        cancelLabel={t('common.cancel')}
        tone="primary"
        loading={sendLink.isPending}
        onConfirm={async () => {
          if (!sendingLinkTo) return;
          await sendLink.mutateAsync({ params: { id: sendingLinkTo.id } }).catch(showError);
          setSendingLinkTo(undefined);
        }}
      />
    </div>
  );
}

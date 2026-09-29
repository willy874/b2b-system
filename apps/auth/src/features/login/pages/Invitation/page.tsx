import { useQuery } from '@tanstack/react-query';

import { getWorkspaceInvitationPreviewQueryOptions } from '@/apis/workspace/get-workspace-invitation-preview/query';
import { useTranslation } from '@/core/locales';

import { InvitationRoute } from '../../routes';
import { AuthShell } from '../AuthShell';
import { ExistingAccountForm } from './components/ExistingAccountForm';
import { NewAccountForm } from './components/NewAccountForm';

/**
 * 接受工作區邀請（docs/adr/0018-workspace-tenancy.md D14）。
 * 還沒有帳號：設定名稱與密碼，建立帳號後直接登入。已有帳號：在這一頁登入（或沿用目前的登入）後接受。
 */
export default function InvitationPage() {
  const { t } = useTranslation();
  const { token } = InvitationRoute.useSearch();
  const preview = useQuery({
    ...getWorkspaceInvitationPreviewQueryOptions(token ?? ''),
    enabled: Boolean(token),
  });

  if (!token || preview.isError) {
    return (
      <AuthShell title={t('login.invitation.title')}>
        <p className="text-sm text-[var(--color-danger-text)]" data-testid="invitation-invalid">
          {t('error.WORKSPACE_INVITATION_INVALID')}
        </p>
      </AuthShell>
    );
  }
  if (!preview.data) {
    return <AuthShell title={t('login.invitation.title')}>{null}</AuthShell>;
  }

  const invitation = preview.data;
  return (
    <AuthShell
      title={t('login.invitation.title')}
      description={
        invitation.inviterName
          ? t('login.invitation.descriptionWithInviter', {
              inviter: invitation.inviterName,
              workspace: invitation.workspaceName,
            })
          : t('login.invitation.description', { workspace: invitation.workspaceName })
      }
    >
      {invitation.hasAccount ? (
        <ExistingAccountForm token={token} invitation={invitation} />
      ) : (
        <NewAccountForm token={token} invitation={invitation} />
      )}
    </AuthShell>
  );
}

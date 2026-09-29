import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { Button } from '@/components/Button';
import { useHasSession } from '@/core/auth';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { WorkspaceInvitationPreview } from '@/shared/api-sdk';

import { useAcceptInvitationMutation } from '../../../hooks/useInvitationMutations';
import { startSsoLogin } from '../../../sso';
import { InvitedEmail } from './InvitedEmail';

interface ExistingAccountFormProps {
  token: string;
  invitation: WorkspaceInvitationPreview;
}

/**
 * 已有帳號：經 SSO 登入受邀的帳號（登入後回到這一頁），再接受。
 * 已登入的是別的帳號時提示，不讓它接受（後端同樣會擋：WORKSPACE_INVITATION_EMAIL_MISMATCH）。
 */
export function ExistingAccountForm({ token, invitation }: ExistingAccountFormProps) {
  const { t } = useTranslation();
  const hasSession = useHasSession();
  const profile = useQuery({ ...getAuthProfileQueryOptions(), enabled: hasSession });
  const accept = useAcceptInvitationMutation();
  const toMessage = useErrorMessage();
  const [formError, setFormError] = useState<{ message: string }>();

  if (!hasSession) {
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-[var(--color-fg-muted)]">
          {t('login.invitation.existingAccount')}
        </p>
        <InvitedEmail email={invitation.email} />
        <Button
          variant="primary"
          block
          onClick={() =>
            void startSsoLogin(`/invitation?${new URLSearchParams({ token }).toString()}`)
          }
          data-testid="invitation-login-submit"
        >
          {t('login.invitation.loginAndAccept')}
        </Button>
      </div>
    );
  }

  if (!profile.data) return null;
  const signedInAs = profile.data.user.email;
  if (signedInAs.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <p className="m-0 text-sm text-[var(--color-danger-text)]" data-testid="invitation-mismatch">
        {t('login.invitation.mismatch', { current: signedInAs, invited: invitation.email })}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm">{t('login.invitation.signedInAs', { email: signedInAs })}</p>
      {formError && (
        <p className="m-0 text-sm text-[var(--color-danger-text)]">{formError.message}</p>
      )}
      <Button
        variant="primary"
        block
        loading={accept.isPending || accept.isSuccess}
        onClick={() =>
          accept
            .mutateAsync({ params: { token } })
            .catch((error: unknown) => setFormError({ message: toMessage(error) }))
        }
        data-testid="invitation-accept"
      >
        {t('login.invitation.accept')}
      </Button>
    </div>
  );
}

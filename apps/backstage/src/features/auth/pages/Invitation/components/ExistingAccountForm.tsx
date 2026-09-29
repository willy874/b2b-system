import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useHasSession } from '@/core/auth';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { WorkspaceInvitationPreview } from '@/shared/api-sdk';
import { firstError, zodFormValidator } from '@/shared/hooks';

import { useEnterInvitedWorkspace } from '../../../hooks/useEnterInvitedWorkspace';
import { useAcceptInvitationMutation } from '../../../hooks/useInvitationMutations';
import { useLoginMutation } from '../../../hooks/useLoginMutation';
import { InvitedEmail } from './InvitedEmail';

const LoginSchema = z.object({ password: z.string().min(1) });

interface ExistingAccountFormProps {
  token: string;
  invitation: WorkspaceInvitationPreview;
}

/** 已有帳號：沒登入就在這裡登入受邀的帳號；已登入的是別的帳號時提示，不讓它接受。 */
export function ExistingAccountForm({ token, invitation }: ExistingAccountFormProps) {
  const { t } = useTranslation();
  const hasSession = useHasSession();
  const profile = useQuery({ ...getAuthProfileQueryOptions(), enabled: hasSession });
  const accept = useAcceptInvitationMutation();
  const login = useLoginMutation();
  const enter = useEnterInvitedWorkspace();
  const toMessage = useErrorMessage();
  const [formError, setFormError] = useState<string>();

  const acceptAndEnter = async () => {
    setFormError(undefined);
    try {
      await enter(await accept.mutateAsync({ params: { token } }));
    } catch (error) {
      setFormError(toMessage(error));
    }
  };

  const form = useForm({
    defaultValues: { password: '' },
    validators: { onSubmit: zodFormValidator(LoginSchema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        await login.mutateAsync({ params: { email: invitation.email, password: value.password } });
      } catch (error) {
        setFormError(toMessage(error));
        return;
      }
      await acceptAndEnter();
    },
  });

  if (hasSession) {
    if (!profile.data) return null;
    const signedInAs = profile.data.user.email;
    if (signedInAs.toLowerCase() !== invitation.email.toLowerCase()) {
      return (
        <p
          className="m-0 text-sm text-[var(--color-danger-text)]"
          data-testid="invitation-mismatch"
        >
          {t('auth.invitation.mismatch', { current: signedInAs, invited: invitation.email })}
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm">{t('auth.invitation.signedInAs', { email: signedInAs })}</p>
        {formError && <p className="m-0 text-sm text-[var(--color-danger-text)]">{formError}</p>}
        <Button
          variant="primary"
          block
          loading={accept.isPending}
          onClick={() => void acceptAndEnter()}
          data-testid="invitation-accept"
        >
          {t('auth.invitation.accept')}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">
        {t('auth.invitation.existingAccount')}
      </p>
      <InvitedEmail email={invitation.email} />
      <form.Field name="password">
        {(field) => (
          <Field
            label={t('auth.field.password')}
            required
            error={firstError(field.state.meta.errors)}
          >
            <Input
              type="password"
              autoComplete="current-password"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
              data-testid="invitation-login-password"
            />
          </Field>
        )}
      </form.Field>
      {formError && <p className="m-0 text-sm text-[var(--color-danger-text)]">{formError}</p>}
      <Button
        type="submit"
        variant="primary"
        block
        loading={login.isPending || accept.isPending}
        data-testid="invitation-login-submit"
      >
        {t('auth.invitation.loginAndAccept')}
      </Button>
    </form>
  );
}

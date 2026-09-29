import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { WorkspaceInvitationPreview } from '@/shared/api-sdk';
import { firstError, zodFormValidator } from '@/shared/hooks';

import { useEnterInvitedWorkspace } from '../../../hooks/useEnterInvitedWorkspace';
import { useSignupInvitationMutation } from '../../../hooks/useInvitationMutations';
import { useLoginMutation } from '../../../hooks/useLoginMutation';
import { InvitedEmail } from './InvitedEmail';

const SignupSchema = z
  .object({
    displayName: z.string().trim().min(1),
    password: z.string().min(12),
    confirmPassword: z.string().min(1),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'passwords do not match',
  });

interface NewAccountFormProps {
  token: string;
  invitation: WorkspaceInvitationPreview;
}

/** 還沒有帳號：建立帳號 → 以剛設定的密碼登入 → 進入工作區。 */
export function NewAccountForm({ token, invitation }: NewAccountFormProps) {
  const { t } = useTranslation();
  const signup = useSignupInvitationMutation();
  const login = useLoginMutation();
  const enter = useEnterInvitedWorkspace();
  const toMessage = useErrorMessage();
  const [formError, setFormError] = useState<string>();

  const form = useForm({
    defaultValues: { displayName: '', password: '', confirmPassword: '' },
    validators: { onSubmit: zodFormValidator(SignupSchema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        const accepted = await signup.mutateAsync({
          params: { token, displayName: value.displayName, password: value.password },
        });
        await login.mutateAsync({ params: { email: accepted.email, password: value.password } });
        await enter(accepted);
      } catch (error) {
        setFormError(toMessage(error));
      }
    },
  });

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('auth.invitation.newAccount')}</p>
      <InvitedEmail email={invitation.email} />
      <form.Field name="displayName">
        {(field) => (
          <Field
            label={t('auth.field.displayName')}
            required
            error={firstError(field.state.meta.errors)}
          >
            <Input
              autoComplete="name"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
              data-testid="invitation-display-name"
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="password">
        {(field) => (
          <Field
            label={t('auth.field.password')}
            description={t('auth.password.hint')}
            required
            error={firstError(field.state.meta.errors)}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
              data-testid="invitation-password"
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="confirmPassword">
        {(field) => (
          <Field
            label={t('auth.invitation.confirmPassword')}
            required
            error={firstError(field.state.meta.errors)}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
              data-testid="invitation-confirm"
            />
          </Field>
        )}
      </form.Field>
      {formError && <p className="m-0 text-sm text-[var(--color-danger-text)]">{formError}</p>}
      <Button
        type="submit"
        variant="primary"
        block
        loading={signup.isPending || login.isPending}
        data-testid="invitation-submit"
      >
        {t('auth.invitation.signup')}
      </Button>
    </form>
  );
}

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

import { useSignupInvitationMutation } from '../../../hooks/useInvitationMutations';
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

/** 還沒有帳號：建立帳號 → 前往工作區（產品經 IdP 登入，用剛設定的密碼）。 */
export function NewAccountForm({ token, invitation }: NewAccountFormProps) {
  const { t } = useTranslation();
  const signup = useSignupInvitationMutation();
  const toMessage = useErrorMessage();
  const [formError, setFormError] = useState<string>();

  const form = useForm({
    defaultValues: { displayName: '', password: '', confirmPassword: '' },
    validators: { onSubmit: zodFormValidator(SignupSchema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        // 成功後頂層跳轉到工作區（useSignupInvitationMutation）；登入在那裡經 IdP 完成
        await signup.mutateAsync({
          params: { token, displayName: value.displayName, password: value.password },
        });
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
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('login.invitation.newAccount')}</p>
      <InvitedEmail email={invitation.email} />
      <form.Field name="displayName">
        {(field) => (
          <Field
            label={t('login.field.displayName')}
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
            label={t('login.field.password')}
            description={t('login.password.hint')}
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
            label={t('login.invitation.confirmPassword')}
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
        loading={signup.isPending || signup.isSuccess}
        data-testid="invitation-submit"
      >
        {t('login.invitation.signup')}
      </Button>
    </form>
  );
}

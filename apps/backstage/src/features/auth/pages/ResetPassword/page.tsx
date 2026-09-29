import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { getResetPasswordMutationOptions } from '@/apis/auth/reset-password/mutation';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { firstError, zodFormValidator } from '@/shared/hooks';

import { ResetPasswordRoute } from '../../routes';
import { AuthShell } from '../AuthShell';

const Schema = z
  .object({ newPassword: z.string().min(12), confirmPassword: z.string().min(1) })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'passwords do not match',
  });

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token } = ResetPasswordRoute.useSearch();
  const reset = useMutation(getResetPasswordMutationOptions());
  const toMessage = useErrorMessage();
  const [formError, setFormError] = useState<string>();

  const form = useForm({
    defaultValues: { newPassword: '', confirmPassword: '' },
    validators: { onSubmit: zodFormValidator(Schema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        await reset.mutateAsync({ params: { token: token ?? '', newPassword: value.newPassword } });
        await navigate({ to: '/auth/login' });
      } catch (error) {
        setFormError(toMessage(error));
      }
    },
  });

  return (
    <AuthShell title={t('auth.resetPassword.title')} description={t('auth.password.hint')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="newPassword">
          {(field) => (
            <Field
              label={t('auth.field.newPassword')}
              required
              error={firstError(field.state.meta.errors)}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                data-testid="reset-password-new"
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="confirmPassword">
          {(field) => (
            <Field
              label={t('auth.field.confirmPassword')}
              required
              error={firstError(field.state.meta.errors)}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                data-testid="reset-password-confirm"
              />
            </Field>
          )}
        </form.Field>
        {formError && <p className="m-0 text-sm text-[var(--color-danger-text)]">{formError}</p>}
        <Button type="submit" variant="primary" block loading={reset.isPending}>
          {t('common.confirm')}
        </Button>
      </form>
    </AuthShell>
  );
}

import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { z } from 'zod';

import { getResetPasswordMutationOptions } from '@/apis/auth/reset-password/mutation';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { firstError, zodFormValidator } from '@/shared/hooks';

import { useAccountPolicy } from '../../hooks/useAccountPolicy';
import { LoginRoute, ResetPasswordRoute } from '../../routes';
import { goToTenantLogin } from '../../tenant';
import { AuthShell } from '../AuthShell';

/** 租戶帳號的密碼長度是租戶的設定（`auth.passwordMinLength`）。 */
function createSchema(passwordMinLength: number) {
  return z
    .object({ newPassword: z.string().min(passwordMinLength), confirmPassword: z.string().min(1) })
    .refine((value) => value.newPassword === value.confirmPassword, {
      path: ['confirmPassword'],
      params: { messageKey: 'validation.passwordMismatch' },
    });
}

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const { token, tenant } = ResetPasswordRoute.useSearch();
  const navigate = useNavigate();
  const reset = useMutation(getResetPasswordMutationOptions());
  const toMessage = useErrorMessage();
  const [formError, setFormError] = useState<string>();
  const { passwordMinLength } = useAccountPolicy(tenant);
  const schema = useMemo(() => createSchema(passwordMinLength), [passwordMinLength]);

  const form = useForm({
    defaultValues: { newPassword: '', confirmPassword: '' },
    validators: { onSubmit: zodFormValidator(schema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        await reset.mutateAsync({
          params: { tenant, token: token ?? '', newPassword: value.newPassword },
        });
        // 租戶的帳號：到那個租戶的 backstage 登入（docs/architecture/05-tenancy.md §10.2 D11）；
        // 沒有租戶是平台管理者的帳號（重設連結由其他平台管理者寄出）：留在 apps/auth 登入
        if (tenant) await goToTenantLogin(tenant);
        else await navigate({ to: LoginRoute.to });
      } catch (error) {
        setFormError(toMessage(error));
      }
    },
  });

  if (!token) {
    return (
      <AuthShell title={t('login.resetPassword.title')}>
        <p className="text-sm text-[var(--color-danger-text)]" data-testid="reset-password-invalid">
          {t('error.AUTH_SETUP_TOKEN_INVALID')}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('login.resetPassword.title')}
      description={t('login.password.hint', { min: passwordMinLength })}
    >
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
              label={t('login.field.newPassword')}
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
              label={t('login.field.confirmPassword')}
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

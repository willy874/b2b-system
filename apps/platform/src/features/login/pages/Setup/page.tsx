import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { firstError, zodFormValidator } from '@b2b-system/web-shared/hooks';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { z } from 'zod';

import { getSetupMutationOptions } from '@/apis/auth/setup/mutation';
import { getVerifySetupQueryOptions } from '@/apis/auth/setup/query';

import { useAccountPolicy } from '../../hooks/useAccountPolicy';
import { LoginRoute, SetupRoute } from '../../routes';
import { goToTenantLogin } from '../../tenant';
import { AuthShell } from '../AuthShell';

/** 租戶帳號的密碼長度是租戶的設定（`auth.passwordMinLength`）。 */
function createSchema(passwordMinLength: number) {
  return z
    .object({ password: z.string().min(passwordMinLength), confirmPassword: z.string().min(1) })
    .refine((value) => value.password === value.confirmPassword, {
      path: ['confirmPassword'],
      params: { messageKey: 'validation.passwordMismatch' },
    });
}

export default function SetupPage() {
  const { t } = useTranslation();
  const { token, tenant } = SetupRoute.useSearch();
  const navigate = useNavigate();
  const verify = useQuery({
    ...getVerifySetupQueryOptions(token ?? '', tenant ?? ''),
    enabled: Boolean(token),
  });
  const setup = useMutation(getSetupMutationOptions());
  const toMessage = useErrorMessage();
  const [formError, setFormError] = useState<string>();
  const { passwordMinLength } = useAccountPolicy(tenant);
  const schema = useMemo(() => createSchema(passwordMinLength), [passwordMinLength]);

  const form = useForm({
    defaultValues: { password: '', confirmPassword: '' },
    validators: { onSubmit: zodFormValidator(schema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        await setup.mutateAsync({
          params: { tenant, token: token ?? '', password: value.password },
        });
        // 租戶的帳號：到那個租戶的 backstage 登入（docs/architecture/05-tenancy.md §10.2 D11）；
        // 沒有租戶是平台管理者的帳號：留在 apps/platform 登入
        if (tenant) await goToTenantLogin(tenant);
        else await navigate({ to: LoginRoute.to });
      } catch (error) {
        setFormError(toMessage(error));
      }
    },
  });

  if (!token || verify.data?.valid === false) {
    return (
      <AuthShell title={t('login.setup.title')}>
        <p className="text-sm text-[var(--color-danger-text)]" data-testid="setup-invalid">
          {t('error.AUTH_SETUP_TOKEN_INVALID')}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('login.setup.title')}
      description={verify.data?.email ?? t('login.password.hint', { min: passwordMinLength })}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="password">
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
                data-testid="setup-password"
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
                data-testid="setup-confirm"
              />
            </Field>
          )}
        </form.Field>
        <FormError data-testid="setup-error">{formError}</FormError>
        <Button
          type="submit"
          variant="primary"
          block
          loading={setup.isPending}
          data-testid="setup-submit"
        >
          {t('login.setup.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}

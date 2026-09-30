import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { getSetupMutationOptions } from '@/apis/auth/setup/mutation';
import { getVerifySetupQueryOptions } from '@/apis/auth/setup/query';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { firstError, zodFormValidator } from '@/shared/hooks';

import { LoginRoute, SetupRoute } from '../../routes';
import { goToTenantLogin } from '../../tenant';
import { AuthShell } from '../AuthShell';

const Schema = z
  .object({ password: z.string().min(12), confirmPassword: z.string().min(1) })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'passwords do not match',
  });

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

  const form = useForm({
    defaultValues: { password: '', confirmPassword: '' },
    validators: { onSubmit: zodFormValidator(Schema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        await setup.mutateAsync({
          params: { tenant, token: token ?? '', password: value.password },
        });
        // 租戶的帳號：到那個租戶的 backstage 登入（docs/adr/0020-physical-tenant-isolation.md D11）；
        // 沒有租戶是平台管理者的帳號：留在 apps/auth 登入
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
      description={verify.data?.email ?? t('login.password.hint')}
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
        {formError && <p className="m-0 text-sm text-[var(--color-danger-text)]">{formError}</p>}
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

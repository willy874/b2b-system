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

import { SetupRoute } from '../../routes';
import { AuthShell } from '../AuthShell';

const Schema = z
  .object({ password: z.string().min(12), confirmPassword: z.string().min(1) })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'passwords do not match',
  });

export default function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token } = SetupRoute.useSearch();
  const verify = useQuery({ ...getVerifySetupQueryOptions(token ?? ''), enabled: Boolean(token) });
  const setup = useMutation(getSetupMutationOptions());
  const toMessage = useErrorMessage();
  const [formError, setFormError] = useState<string>();

  const form = useForm({
    defaultValues: { password: '', confirmPassword: '' },
    validators: { onSubmit: zodFormValidator(Schema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        await setup.mutateAsync({ params: { token: token ?? '', password: value.password } });
        await navigate({ to: '/auth/login' });
      } catch (error) {
        setFormError(toMessage(error));
      }
    },
  });

  if (!token || verify.data?.valid === false) {
    return (
      <AuthShell title={t('auth.setup.title')}>
        <p className="text-sm text-[var(--color-danger-text)]" data-testid="setup-invalid">
          {t('error.AUTH_SETUP_TOKEN_INVALID')}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('auth.setup.title')}
      description={verify.data?.email ?? t('auth.password.hint')}
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
                data-testid="setup-password"
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
          {t('auth.setup.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}

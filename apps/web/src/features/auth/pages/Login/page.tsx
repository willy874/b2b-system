import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { firstError, zodFormValidator } from '@/shared/hooks';

import { useLoginMutation } from '../../hooks/useLoginMutation';
import { LoginRoute } from '../../routes';
import { AuthShell } from '../AuthShell';

const LoginFormSchema = z.object({
  email: z.string().min(1).email(),
  password: z.string().min(1),
});

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = LoginRoute.useSearch();
  const login = useLoginMutation();
  const toMessage = useErrorMessage();
  const [formError, setFormError] = useState<string>();

  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: { onSubmit: zodFormValidator(LoginFormSchema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        await login.mutateAsync({ params: value });
        await navigate({ to: search.redirect ?? '/' });
      } catch (error) {
        setFormError(toMessage(error));
      }
    },
  });

  return (
    <AuthShell
      title={t('auth.login.title')}
      description={t('auth.login.description')}
      footer={
        <a className="text-[var(--color-brand)]" href="/auth/forgot-password">
          {t('auth.login.forgotPassword')}
        </a>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="email">
          {(field) => (
            <Field
              label={t('auth.field.email')}
              required
              error={firstError(field.state.meta.errors)}
            >
              <Input
                type="email"
                autoComplete="username"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                data-testid="login-email"
              />
            </Field>
          )}
        </form.Field>

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
                data-testid="login-password"
              />
            </Field>
          )}
        </form.Field>

        {formError && (
          <p className="m-0 text-sm text-[var(--color-danger-text)]" data-testid="login-error">
            {formError}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          block
          loading={login.isPending}
          data-testid="login-submit"
        >
          {t('auth.login.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}

import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { firstError, zodFormValidator } from '@/shared/hooks';

import { CLIENT_NAME_KEY } from '../../constants';
import {
  useSsoInteraction,
  useSsoInteractionAbortMutation,
  useSsoInteractionLoginMutation,
} from '../../hooks/useSsoInteraction';
import { InteractionRoute } from '../../routes';
import { AuthShell } from '../AuthShell';

const LoginFormSchema = z.object({
  email: z.string().min(1).email(),
  password: z.string().min(1),
});

/**
 * IdP 的登入互動頁（docs/adr/0019-sso-identity-platform.md）：產品把使用者導到 IdP，沒有 IdP session 時
 * provider 轉到這裡。登入成功後頂層跳轉回 provider，provider 帶授權碼跳回產品。
 * 所有產品的密碼登入都在這一頁（帳密檢查與 `POST /auth/login` 同一套）。
 */
export default function InteractionPage() {
  const { t } = useTranslation();
  const { uid } = InteractionRoute.useParams();
  const interaction = useSsoInteraction(uid);
  const login = useSsoInteractionLoginMutation();
  const abort = useSsoInteractionAbortMutation();
  const toMessage = useErrorMessage();
  const [formError, setFormError] = useState<string>();

  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: { onSubmit: zodFormValidator(LoginFormSchema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        await login.mutateAsync({ params: { uid, ...value } });
      } catch (error) {
        setFormError(toMessage(error));
      }
    },
  });

  if (interaction.isError) {
    return (
      <AuthShell title={t('login.title')}>
        <p
          className="m-0 text-sm text-[var(--color-danger-text)]"
          data-testid="interaction-invalid"
        >
          {t('error.AUTH_SSO_INTERACTION_INVALID')}
        </p>
      </AuthShell>
    );
  }

  const client = interaction.data?.clientId;
  return (
    <AuthShell
      title={t('login.title')}
      description={
        client
          ? t('login.interaction.for', {
              client: t(CLIENT_NAME_KEY[client] ?? 'login.client.unknown'),
            })
          : undefined
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
              label={t('login.field.email')}
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
              label={t('login.field.password')}
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
          loading={login.isPending || login.isSuccess}
          disabled={!interaction.data}
          data-testid="login-submit"
        >
          {t('login.submit')}
        </Button>
        <Button
          variant="ghost"
          block
          loading={abort.isPending}
          disabled={!interaction.data || login.isPending}
          onClick={() => abort.mutate({ params: { uid } })}
          data-testid="login-cancel"
        >
          {t('login.interaction.cancel')}
        </Button>
      </form>
    </AuthShell>
  );
}

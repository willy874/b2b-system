import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { getErrorMessageKey, useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { firstError, zodFormValidator } from '@/shared/hooks';

import { CLIENT_NAME_KEY } from '../../constants';
import {
  useSsoDiscovery,
  useSsoInteraction,
  useSsoInteractionAbortMutation,
  useSsoInteractionLoginMutation,
  useStartExternalLoginMutation,
} from '../../hooks/useSsoInteraction';
import { InteractionRoute } from '../../routes';
import { AuthShell } from '../AuthShell';

const EmailSchema = z.string().trim().min(1).email();

const LoginFormSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
});

/**
 * IdP 的登入互動頁（docs/adr/0019-sso-identity-platform.md）：產品把使用者導到 IdP，沒有 IdP session 時
 * provider 轉到這裡。登入成功後頂層跳轉回 provider，provider 帶授權碼跳回產品。
 * 所有產品的密碼登入都在這一頁（帳密檢查與 `POST /auth/login` 同一套）。
 *
 * email 網域有外部 IdP 連線時多一個「使用 X 登入」（D9）；網域只允許 SSO 時不顯示密碼欄。
 * 外部 IdP 登入失敗時 api 帶 `?error=<錯誤碼>` 回到這一頁。
 */
export default function InteractionPage() {
  const { t } = useTranslation();
  const { uid } = InteractionRoute.useParams();
  const search = InteractionRoute.useSearch();
  const interaction = useSsoInteraction(uid);
  const login = useSsoInteractionLoginMutation();
  const abort = useSsoInteractionAbortMutation();
  const external = useStartExternalLoginMutation();
  const toMessage = useErrorMessage();
  const [formError, setFormError] = useState<string>();
  // 網址帶來的錯誤只顯示到使用者再試一次為止
  const [showSearchError, setShowSearchError] = useState(true);
  /** 拿去查網域的 email：離開欄位（或送出）時才更新，不在每次輸入時查詢。 */
  const [discoveryEmail, setDiscoveryEmail] = useState<string>();
  const discovery = useSsoDiscovery(uid, discoveryEmail);
  const provider = discovery.data?.provider ?? null;
  const ssoOnly = Boolean(provider && discovery.data?.ssoOnly);

  const discover = (email: string) => {
    const parsed = EmailSchema.safeParse(email);
    setDiscoveryEmail(parsed.success ? parsed.data : undefined);
  };

  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: { onSubmit: zodFormValidator(LoginFormSchema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      setShowSearchError(false);
      try {
        await login.mutateAsync({ params: { uid, ...value } });
      } catch (error) {
        setFormError(toMessage(error));
      }
    },
  });

  const startExternal = async () => {
    if (!provider) return;
    setFormError(undefined);
    setShowSearchError(false);
    try {
      await external.mutateAsync({ params: { uid, providerId: provider.id } });
    } catch (error) {
      setFormError(toMessage(error));
    }
  };

  const searchErrorKey = search.error ? getErrorMessageKey(search.error) : undefined;
  const searchError = showSearchError ? search.error : undefined;
  const redirecting =
    login.isPending || login.isSuccess || external.isPending || external.isSuccess;

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
      footer={
        <div className="flex justify-between gap-2">
          <a className="text-[var(--color-brand)]" href="/forgot-password">
            {t('login.interaction.forgotPassword')}
          </a>
          <a
            className="text-[var(--color-brand)]"
            href="/register"
            data-testid="login-register-link"
          >
            {t('login.interaction.register')}
          </a>
        </div>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (ssoOnly) void startExternal();
          else void form.handleSubmit();
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
                onBlur={() => {
                  field.handleBlur();
                  discover(field.state.value);
                }}
                data-testid="login-email"
              />
            </Field>
          )}
        </form.Field>

        {ssoOnly && provider && (
          <p className="m-0 text-sm text-[var(--color-fg-muted)]" data-testid="login-sso-only">
            {t('login.interaction.ssoOnly', { name: provider.name })}
          </p>
        )}

        {!ssoOnly && (
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
        )}

        {(formError ?? searchError) !== undefined && (
          <p
            className="m-0 text-sm text-[var(--color-danger-text)]"
            data-testid="login-error"
            data-value={formError === undefined ? searchError : undefined}
          >
            {formError ?? t(searchErrorKey ?? 'login.error.generic')}
          </p>
        )}

        {!ssoOnly && (
          <Button
            type="submit"
            variant="primary"
            block
            loading={login.isPending || login.isSuccess}
            disabled={!interaction.data || external.isPending}
            data-testid="login-submit"
          >
            {t('login.submit')}
          </Button>
        )}
        {provider && (
          <>
            {!ssoOnly && (
              <p className="m-0 text-center text-xs text-[var(--color-fg-muted)]">
                {t('login.interaction.or')}
              </p>
            )}
            <Button
              type={ssoOnly ? 'submit' : 'button'}
              variant={ssoOnly ? 'primary' : 'secondary'}
              block
              loading={external.isPending || external.isSuccess}
              disabled={!interaction.data || login.isPending}
              onClick={ssoOnly ? undefined : () => void startExternal()}
              data-testid="login-external"
              data-value={provider.id}
            >
              {t('login.interaction.external', { name: provider.name })}
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          block
          loading={abort.isPending}
          disabled={!interaction.data || redirecting}
          onClick={() => abort.mutate({ params: { uid } })}
          data-testid="login-cancel"
        >
          {t('login.interaction.cancel')}
        </Button>
      </form>
    </AuthShell>
  );
}

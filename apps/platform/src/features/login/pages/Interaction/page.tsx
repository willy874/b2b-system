import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { useTranslation } from '@b2b-system/web-core/locales';
import { firstError } from '@b2b-system/web-shared/hooks';

import { PasswordInput } from '../../components/PasswordInput';
import { CLIENT_NAME_KEY } from '../../constants';
import { useInteractionLogin } from '../../hooks/useInteractionLogin';
import { InteractionRoute } from '../../routes';
import { AuthShell } from '../AuthShell';
import { InteractionFooter } from './components/InteractionFooter';
import { InteractionInvalid } from './components/InteractionInvalid';
import { MfaStepPanel } from './components/MfaStepPanel';
import { PasskeyLoginButton } from './components/PasskeyLoginButton';

/**
 * IdP 的登入互動頁（docs/architecture/04-sso.md §12）：產品把使用者導到 IdP，沒有 IdP session 時
 * provider 轉到這裡。登入成功後頂層跳轉回 provider，provider 帶授權碼跳回產品。
 * 所有產品的密碼登入都在這一頁（帳密檢查與 `POST /auth/login` 同一套）。
 *
 * email 網域有外部 IdP 連線時多一個「使用 X 登入」（D9）；網域只允許 SSO 時不顯示密碼欄。
 * 外部 IdP 登入失敗時 api 帶 `?error=<錯誤碼>` 回到這一頁。流程在 `useInteractionLogin`，這裡只渲染。
 * 帳號需要 MFA 時，密碼通過後換成第二步（`MfaStepPanel`，docs/architecture/backend/21-mfa.md §4）。
 * 平台開放、租戶允許時多一個「使用通行金鑰登入」，取代密碼與第二步（docs/architecture/04-sso.md §3.6）。
 */
export default function InteractionPage() {
  const { t } = useTranslation();
  const { uid } = InteractionRoute.useParams();
  const search = InteractionRoute.useSearch();
  const {
    interaction,
    policy,
    form,
    emailRef,
    discover,
    provider,
    ssoOnly,
    expired,
    formError,
    retryIn,
    searchError,
    searchErrorKey,
    redirecting,
    loggingIn,
    loginPending,
    externalPending,
    externalStarting,
    cancelling,
    startExternal,
    cancel,
    mfaStep,
    restartMfa,
    advanceMfa,
  } = useInteractionLogin(uid, search.error);

  // 互動已經找不到（過期、重複使用）：不知道是哪個產品或租戶，給「進入租戶」與平台管理者的登入
  if (interaction.isError) return <InteractionInvalid />;

  const client = interaction.data?.clientId;
  // 帶租戶的互動：登入那個租戶的帳號；沒有租戶是平台管理者（docs/architecture/05-tenancy.md §10.2 D8）
  const tenant = interaction.data?.tenant;
  if (expired)
    return <InteractionInvalid tenant={tenant?.code} platform={!tenant && client === 'auth'} />;
  return (
    <AuthShell
      title={t('login.title')}
      description={
        client
          ? tenant
            ? t('login.interaction.forTenant', {
                tenant: tenant.name,
                client: t(CLIENT_NAME_KEY[client] ?? 'login.client.unknown'),
              })
            : t('login.interaction.forPlatform')
          : undefined
      }
      footer={
        <InteractionFooter
          tenantCode={tenant?.code}
          // 租戶關閉了註冊就不顯示；載入中先不顯示，免得出現後又消失
          showRegister={policy.registrationEnabled && !policy.isLoading}
        />
      }
    >
      {interaction.data?.mfaEnroll && (
        <p
          className="m-0 mb-3 rounded-[var(--radius-md)] bg-[var(--color-fill-subtle)] p-3 text-sm"
          data-testid="login-mfa-enroll-notice"
          data-value={interaction.data.mfaEnroll}
        >
          {t('login.interaction.mfaEnroll')}
        </p>
      )}
      {mfaStep ? (
        <MfaStepPanel
          // 驗證通過後換成設定的步驟：重新掛載，讓第二步的表單狀態不帶到設定
          key={mfaStep.next}
          uid={uid}
          step={mfaStep}
          email={form.state.values.email}
          onRestart={restartMfa}
          onNext={advanceMfa}
        />
      ) : (
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
                  ref={emailRef}
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
                  <PasswordInput
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

          <FormError
            code={formError === undefined ? searchError : formError.code}
            data-testid="login-error"
          >
            {(formError ?? searchError) !== undefined &&
              (formError?.message ?? t(searchErrorKey ?? 'login.error.generic'))}
          </FormError>

          {!ssoOnly && (
            <Button
              type="submit"
              variant="primary"
              block
              loading={loggingIn}
              disabled={!interaction.data || externalPending || retryIn > 0}
              data-testid="login-submit"
            >
              {retryIn > 0 ? t('login.retryIn', { count: retryIn }) : t('login.submit')}
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
                loading={externalStarting}
                disabled={!interaction.data || loginPending}
                onClick={ssoOnly ? undefined : () => void startExternal()}
                data-testid="login-external"
                data-value={provider.id}
              >
                {t('login.interaction.external', { name: provider.name })}
              </Button>
            </>
          )}
          {interaction.data?.passkeyLogin && !ssoOnly && (
            <PasskeyLoginButton uid={uid} disabled={loginPending || externalPending} />
          )}
          <Button
            variant="ghost"
            block
            loading={cancelling}
            disabled={!interaction.data || redirecting}
            onClick={cancel}
            data-testid="login-cancel"
          >
            {t('login.interaction.cancel')}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

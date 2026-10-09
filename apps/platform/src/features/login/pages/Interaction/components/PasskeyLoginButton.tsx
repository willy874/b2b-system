import { Button } from '@b2b-system/ui/Button';
import { FormError } from '@b2b-system/ui/FormError';
import { useTranslation } from '@b2b-system/web-core/locales';
import { supportsWebAuthn } from '@b2b-system/web-core/mfa';

import { usePasskeyLogin } from '../../../hooks/usePasskeyLogin';

interface PasskeyLoginButtonProps {
  uid: string;
  /** 密碼登入或外部 IdP 已在進行：停用。 */
  disabled: boolean;
}

/** 「使用通行金鑰登入」（docs/architecture/04-sso.md §3.6）：瀏覽器不支援 WebAuthn 時不顯示。 */
export function PasskeyLoginButton({ uid, disabled }: PasskeyLoginButtonProps) {
  const { t } = useTranslation();
  const passkey = usePasskeyLogin(uid);
  if (!supportsWebAuthn()) return null;
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        block
        loading={passkey.pending}
        disabled={disabled}
        onClick={() => void passkey.start()}
        data-testid="login-passkey"
      >
        {t('login.interaction.passkey')}
      </Button>
      <FormError code={passkey.error?.code} data-testid="login-passkey-error">
        {passkey.error?.message}
      </FormError>
    </div>
  );
}

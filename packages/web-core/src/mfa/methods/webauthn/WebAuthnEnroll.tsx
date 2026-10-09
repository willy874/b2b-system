import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { useState } from 'react';

import { useTranslation } from '../../../locales';
import type { MfaEnrollProps } from '../../registry';
import { ceremonyErrorKey, isExpired, register, supportsWebAuthn } from './ceremony';

/**
 * 新增安全金鑰或通行金鑰：取名 → 按下按鈕（瀏覽器要求在使用者的點擊裡呼叫 API）→ 依瀏覽器的提示觸碰金鑰或驗證指紋。
 * challenge 在開始設定時已由伺服器產生；過期時先重新取得再按一次。
 */
export default function WebAuthnEnroll({
  challenge,
  onSubmit,
  onResend,
  requesting,
  pending,
  error,
}: MfaEnrollProps) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(() => t('mfa.webauthn.defaultLabel'));
  const [localError, setLocalError] = useState<string>();
  const [working, setWorking] = useState(false);

  if (!supportsWebAuthn()) {
    return (
      <p className="m-0 text-sm" data-testid="mfa-webauthn-unsupported">
        {t('mfa.webauthn.unsupported')}
      </p>
    );
  }

  const run = async () => {
    setLocalError(undefined);
    // 過期與否在按下時判斷（render 裡不讀時間）
    if (isExpired(challenge)) {
      onResend?.();
      setLocalError(t('mfa.webauthn.retry'));
      return;
    }
    setWorking(true);
    try {
      const response = await register(challenge);
      onSubmit({
        payload: { response },
        label: label.trim() || undefined,
        challengeId: challenge.challengeId,
      });
    } catch (cause) {
      setLocalError(t(ceremonyErrorKey(cause)));
    } finally {
      setWorking(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run();
      }}
      data-testid="mfa-webauthn-enroll"
    >
      <p className="m-0 text-sm">{t('mfa.webauthn.enrollIntro')}</p>
      <Field label={t('mfa.webauthn.label')} description={t('mfa.webauthn.labelHint')}>
        <Input
          value={label}
          maxLength={64}
          onChange={(event) => setLabel(event.target.value)}
          data-testid="mfa-webauthn-label"
        />
      </Field>
      <FormError code={localError ? undefined : error?.code} data-testid="mfa-error">
        {localError ?? error?.message}
      </FormError>
      <Button
        type="submit"
        variant="primary"
        block
        loading={working || pending || requesting}
        data-testid="mfa-webauthn-register"
      >
        {t('mfa.webauthn.register')}
      </Button>
    </form>
  );
}

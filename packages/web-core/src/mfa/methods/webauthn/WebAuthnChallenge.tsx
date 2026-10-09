import { Button } from '@b2b-system/ui/Button';
import { FormError } from '@b2b-system/ui/FormError';
import { useEffect, useRef, useState } from 'react';

import { useTranslation } from '../../../locales';
import type { MfaChallengeProps } from '../../registry';
import { authenticate, ceremonyErrorKey, isExpired, supportsWebAuthn } from './ceremony';

/**
 * 登入的第二步：選到這個因子時先向伺服器取得 challenge（不需要使用者的點擊），再由使用者按下按鈕呼叫瀏覽器 API
 * （Safari 要求在點擊裡呼叫）。取消或失敗時可以再按一次；challenge 過期時重新取得。
 */
export default function WebAuthnChallenge({
  factor,
  challenge,
  onRequestChallenge,
  requesting,
  onSubmit,
  pending,
  error,
}: MfaChallengeProps) {
  const { t } = useTranslation();
  const [localError, setLocalError] = useState<string>();
  const [working, setWorking] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current || challenge || !supportsWebAuthn()) return;
    requested.current = true;
    onRequestChallenge?.();
  }, [challenge, onRequestChallenge]);

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
      onRequestChallenge?.();
      setLocalError(t('mfa.webauthn.retry'));
      return;
    }
    setWorking(true);
    try {
      const response = await authenticate(challenge);
      onSubmit({ payload: { response }, challengeId: challenge.challengeId });
    } catch (cause) {
      setLocalError(t(ceremonyErrorKey(cause)));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="mfa-webauthn-challenge">
      <p className="m-0 text-sm">
        {t('mfa.webauthn.useKey', { name: factor.label ?? t('mfa.method.webauthn.label') })}
      </p>
      <FormError code={localError ? undefined : error?.code} data-testid="mfa-error">
        {localError ?? error?.message}
      </FormError>
      <Button
        variant="primary"
        block
        loading={working || pending || requesting}
        onClick={() => void run()}
        data-testid="mfa-webauthn-authenticate"
      >
        {t('mfa.webauthn.authenticate')}
      </Button>
    </div>
  );
}

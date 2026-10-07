import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { useEffect, useRef, useState } from 'react';

import { useTranslation } from '../../../locales';
import { CodeInput } from '../../components/CodeInput';
import type { MfaChallengeProps } from '../../registry';
import { useResendCountdown } from './useResendCountdown';

/** 登入的第二步：先請伺服器寄出驗證碼，再輸入收到的 6 位數；可以重寄（冷卻倒數）。 */
export default function EmailChallenge({
  factor,
  challenge,
  onRequestChallenge,
  requesting,
  onSubmit,
  pending,
  error,
}: MfaChallengeProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const resendIn = useResendCountdown(challenge);
  const inputRef = useRef<HTMLInputElement>(null);
  const sent = challenge !== null;
  useEffect(() => {
    if (sent) inputRef.current?.focus();
  }, [sent]);

  if (!challenge) {
    return (
      <div className="flex flex-col gap-3" data-testid="mfa-email-challenge">
        <p className="m-0 text-sm">{t('mfa.email.willSend', { address: factor.hint ?? '' })}</p>
        <FormError code={error?.code} data-testid="mfa-error">
          {error?.message}
        </FormError>
        <Button
          variant="primary"
          block
          loading={requesting}
          onClick={onRequestChallenge}
          data-testid="mfa-email-send"
        >
          {t('mfa.email.send')}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ payload: { code }, challengeId: challenge.challengeId });
      }}
      data-testid="mfa-email-challenge"
    >
      <p className="m-0 text-sm">
        {t('mfa.email.sentTo', { address: challenge.hint ?? factor.hint ?? '' })}
      </p>
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">{t('mfa.email.delayHint')}</p>
      <Field label={t('mfa.email.code')} required>
        <CodeInput value={code} onChange={setCode} ref={inputRef} data-testid="mfa-code" />
      </Field>
      <FormError code={error?.code} data-testid="mfa-error">
        {error?.message}
      </FormError>
      <Button
        type="submit"
        variant="primary"
        block
        loading={pending}
        disabled={code.length !== 6}
        data-testid="mfa-submit"
      >
        {t('mfa.challenge.verify')}
      </Button>
      <Button
        variant="ghost"
        block
        loading={requesting}
        disabled={resendIn > 0}
        onClick={onRequestChallenge}
        data-testid="mfa-email-resend"
      >
        {resendIn > 0 ? t('mfa.email.resendIn', { count: resendIn }) : t('mfa.email.resend')}
      </Button>
    </form>
  );
}

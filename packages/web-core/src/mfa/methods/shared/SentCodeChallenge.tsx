import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { useEffect, useRef, useState } from 'react';

import { useTranslation } from '../../../locales';
import { CodeInput } from '../../components/CodeInput';
import type { MfaChallengeProps } from '../../registry';
import { useResendCountdown } from './useResendCountdown';

export interface SentCodeChallengeProps extends MfaChallengeProps {
  /** 方式的字串前綴（`mfa.sms`）：`willSend`、`sentTo`、`send`、`resend`、`resendIn`、`delayHint`。 */
  textPrefix: string;
  /** 方式的 data-testid 前綴（`mfa-sms`）：`-challenge`、`-send`、`-resend`。 */
  testIdPrefix: string;
}

/**
 * 由伺服器送出驗證碼的方式的第二步（簡訊、通訊軟體；docs/architecture/backend/21-mfa.md §9.4、§9.5）：
 * 先請伺服器送出，再輸入收到的 6 位數；可以重送（冷卻倒數）。
 */
export function SentCodeChallenge({
  factor,
  challenge,
  onRequestChallenge,
  requesting,
  onSubmit,
  pending,
  error,
  textPrefix,
  testIdPrefix,
}: SentCodeChallengeProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const resendIn = useResendCountdown(challenge);
  const inputRef = useRef<HTMLInputElement>(null);
  const sent = challenge !== null;
  useEffect(() => {
    if (sent) inputRef.current?.focus();
  }, [sent]);
  const address = challenge?.hint ?? factor.hint ?? factor.label ?? '';

  if (!challenge) {
    return (
      <div className="flex flex-col gap-3" data-testid={`${testIdPrefix}-challenge`}>
        <p className="m-0 text-sm">{t(`${textPrefix}.willSend`, { address })}</p>
        <FormError code={error?.code} data-testid="mfa-error">
          {error?.message}
        </FormError>
        <Button
          variant="primary"
          block
          loading={requesting}
          onClick={onRequestChallenge}
          data-testid={`${testIdPrefix}-send`}
        >
          {t(`${textPrefix}.send`)}
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
      data-testid={`${testIdPrefix}-challenge`}
    >
      <p className="m-0 text-sm">{t(`${textPrefix}.sentTo`, { address })}</p>
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">{t(`${textPrefix}.delayHint`)}</p>
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
        data-testid={`${testIdPrefix}-resend`}
      >
        {resendIn > 0
          ? t(`${textPrefix}.resendIn`, { count: resendIn })
          : t(`${textPrefix}.resend`)}
      </Button>
    </form>
  );
}

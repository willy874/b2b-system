import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { useState } from 'react';

import { useTranslation } from '../../../locales';
import { CodeInput } from '../../components/CodeInput';
import type { MfaEnrollProps } from '../../registry';
import { useResendCountdown } from './useResendCountdown';

export interface SentCodeEnrollFormProps extends Pick<
  MfaEnrollProps,
  'challenge' | 'onSubmit' | 'onResend' | 'requesting' | 'pending' | 'error'
> {
  textPrefix: string;
  testIdPrefix: string;
  /** 送到哪裡（遮蔽過的號碼、通訊軟體的名稱）。 */
  address: string;
}

/** 設定時輸入伺服器送出的第一個碼（確認收得到才算設定完成）；簡訊與通訊軟體共用。 */
export function SentCodeEnrollForm({
  challenge,
  onSubmit,
  onResend,
  requesting,
  pending,
  error,
  textPrefix,
  testIdPrefix,
  address,
}: SentCodeEnrollFormProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const resendIn = useResendCountdown(challenge);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ payload: { code }, challengeId: challenge?.challengeId });
      }}
      data-testid={`${testIdPrefix}-enroll-code`}
    >
      <p className="m-0 text-sm">{t(`${textPrefix}.sentTo`, { address })}</p>
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">{t(`${textPrefix}.delayHint`)}</p>
      <Field label={t('mfa.email.code')} required>
        <CodeInput value={code} onChange={setCode} data-testid={`${testIdPrefix}-code`} />
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
        data-testid={`${testIdPrefix}-confirm`}
      >
        {t('mfa.enroll.confirm')}
      </Button>
      {onResend && (
        <Button
          variant="ghost"
          block
          loading={requesting}
          disabled={resendIn > 0}
          onClick={onResend}
          data-testid={`${testIdPrefix}-resend`}
        >
          {resendIn > 0
            ? t(`${textPrefix}.resendIn`, { count: resendIn })
            : t(`${textPrefix}.resend`)}
        </Button>
      )}
    </form>
  );
}

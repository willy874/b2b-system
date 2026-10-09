import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { useState } from 'react';

import { useTranslation } from '../../../locales';
import { CodeInput } from '../../components/CodeInput';
import type { MfaEnrollProps } from '../../registry';
import { useResendCountdown } from '../shared/useResendCountdown';

/** Email 驗證碼的設定：開始設定時已寄出一封，輸入收到的碼確認收得到。 */
export default function EmailEnroll({
  enrollment,
  challenge,
  onSubmit,
  onResend,
  pending,
  error,
}: MfaEnrollProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const resendIn = useResendCountdown(challenge);
  const address =
    typeof enrollment.publicData.email === 'string' ? enrollment.publicData.email : '';
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ payload: { code }, challengeId: challenge?.challengeId });
      }}
      data-testid="mfa-email-enroll"
    >
      <p className="m-0 text-sm">{t('mfa.email.sentTo', { address })}</p>
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">{t('mfa.email.delayHint')}</p>
      <Field label={t('mfa.email.code')} required>
        <CodeInput value={code} onChange={setCode} data-testid="mfa-email-code" />
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
        data-testid="mfa-email-confirm"
      >
        {t('mfa.enroll.confirm')}
      </Button>
      {onResend && (
        <Button
          variant="ghost"
          block
          disabled={resendIn > 0}
          onClick={onResend}
          data-testid="mfa-email-resend"
        >
          {resendIn > 0 ? t('mfa.email.resendIn', { count: resendIn }) : t('mfa.email.resend')}
        </Button>
      )}
    </form>
  );
}

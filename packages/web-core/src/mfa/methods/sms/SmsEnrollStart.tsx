import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { useState } from 'react';

import { useTranslation } from '../../../locales';
import type { MfaEnrollStartProps } from '../../registry';

/**
 * 國碼 ＋ 國內號碼 → E.164（`+886912345678`）：國內號碼開頭的 0（台灣的 09…）去掉，其他非數字的字元也去掉。
 * 伺服器另外檢查國碼在平台允許的清單裡。
 */
export function toE164(countryCode: string, local: string): string {
  const country = countryCode.replace(/\D/g, '');
  const number = local.replace(/\D/g, '').replace(/^0+/, '');
  return country && number ? `+${country}${number}` : '';
}

/** 簡訊的設定：先輸入手機號碼，送出後伺服器會傳第一則驗證碼。 */
export default function SmsEnrollStart({ onStart, pending, error }: MfaEnrollStartProps) {
  const { t } = useTranslation();
  const [countryCode, setCountryCode] = useState('886');
  const [local, setLocal] = useState('');
  const phone = toE164(countryCode, local);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (phone) onStart({ phone });
      }}
      data-testid="mfa-sms-start"
    >
      <p className="m-0 text-sm">{t('mfa.sms.enterPhone')}</p>
      <div className="flex gap-2">
        <Field label={t('mfa.sms.countryCode')} className="w-24">
          <Input
            value={countryCode}
            inputMode="numeric"
            onChange={(event) =>
              setCountryCode(event.target.value.replace(/[^\d]/g, '').slice(0, 4))
            }
            data-testid="mfa-sms-country"
          />
        </Field>
        <Field label={t('mfa.sms.phone')} required className="flex-1">
          <Input
            value={local}
            type="tel"
            autoComplete="tel-national"
            onChange={(event) => setLocal(event.target.value)}
            data-testid="mfa-sms-phone"
          />
        </Field>
      </div>
      {phone && (
        <p className="m-0 text-xs text-[var(--color-fg-muted)]" data-testid="mfa-sms-preview">
          {t('mfa.sms.willSendTo', { phone })}
        </p>
      )}
      <FormError code={error?.code} data-testid="mfa-error">
        {error?.message}
      </FormError>
      <Button
        type="submit"
        variant="primary"
        block
        loading={pending}
        disabled={!phone}
        data-testid="mfa-sms-start-submit"
      >
        {t('mfa.sms.sendCode')}
      </Button>
    </form>
  );
}

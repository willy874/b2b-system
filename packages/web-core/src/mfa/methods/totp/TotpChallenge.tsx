import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { useEffect, useRef, useState } from 'react';

import { useTranslation } from '../../../locales';
import { CodeInput } from '../../components/CodeInput';
import type { MfaChallengeProps } from '../../registry';

/** 登入的第二步：輸入驗證器 App 上的 6 位數。 */
export default function TotpChallenge({ onSubmit, pending, error }: MfaChallengeProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  // 第二步一出現就能直接輸入（不用 autoFocus：jsx-a11y）
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ payload: { code } });
      }}
      data-testid="mfa-totp-challenge"
    >
      <Field label={t('mfa.totp.code')} description={t('mfa.totp.codeHint')} required>
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
    </form>
  );
}

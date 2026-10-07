import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { useEffect, useState } from 'react';

import { useTranslation } from '../../../locales';
import { CodeInput } from '../../components/CodeInput';
import type { MfaEnrollProps } from '../../registry';

/** `qrcode` 只在這個元件載入（docs/architecture/backend/21-mfa.md §11：不進主要 bundle）。 */
function useQrCode(uri: string | undefined): string | undefined {
  const [image, setImage] = useState<{ uri: string; dataUrl: string }>();
  useEffect(() => {
    if (!uri) return undefined;
    let cancelled = false;
    void import('qrcode').then(async (QRCode) => {
      const dataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 200 });
      if (!cancelled) setImage({ uri, dataUrl });
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);
  return image && image.uri === uri ? image.dataUrl : undefined;
}

/** 驗證器 App 的設定：掃 QR code（或手動輸入金鑰）→ 輸入 App 顯示的第一個碼。 */
export default function TotpEnroll({ enrollment, onSubmit, pending, error }: MfaEnrollProps) {
  const { t } = useTranslation();
  const uri =
    typeof enrollment.publicData.otpauthUri === 'string'
      ? enrollment.publicData.otpauthUri
      : undefined;
  const secret =
    typeof enrollment.publicData.secret === 'string' ? enrollment.publicData.secret : '';
  const qr = useQrCode(uri);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ payload: { code }, label: label.trim() || undefined });
      }}
      data-testid="mfa-totp-enroll"
    >
      <p className="m-0 text-sm">{t('mfa.totp.scan')}</p>
      <div className="flex justify-center">
        {qr ? (
          <img
            src={qr}
            alt={t('mfa.totp.qrAlt')}
            width={200}
            height={200}
            data-testid="mfa-totp-qr"
          />
        ) : (
          <Skeleton className="h-[200px] w-[200px]" />
        )}
      </div>
      {showSecret ? (
        <p
          className="m-0 break-all text-center font-mono text-sm"
          data-testid="mfa-totp-secret"
          data-value={secret.replace(/\s/g, '')}
        >
          {secret}
        </p>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowSecret(true)}
          data-testid="mfa-totp-show-secret"
        >
          {t('mfa.totp.cantScan')}
        </Button>
      )}
      <Field label={t('mfa.totp.code')} required>
        <CodeInput value={code} onChange={setCode} data-testid="mfa-totp-code" />
      </Field>
      <Field label={t('mfa.totp.label')} description={t('mfa.totp.labelHint')}>
        <Input
          value={label}
          maxLength={64}
          onChange={(event) => setLabel(event.target.value)}
          data-testid="mfa-totp-label"
        />
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
        data-testid="mfa-totp-confirm"
      >
        {t('mfa.enroll.confirm')}
      </Button>
    </form>
  );
}

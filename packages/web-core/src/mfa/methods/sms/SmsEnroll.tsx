import type { MfaEnrollProps } from '../../registry';
import { SentCodeEnrollForm } from '../shared/SentCodeEnrollForm';

/** 簡訊的設定：開始設定時已送出第一則簡訊，輸入收到的碼確認收得到。 */
export default function SmsEnroll({ enrollment, ...props }: MfaEnrollProps) {
  const phone = typeof enrollment.publicData.phone === 'string' ? enrollment.publicData.phone : '';
  return (
    <SentCodeEnrollForm {...props} address={phone} textPrefix="mfa.sms" testIdPrefix="mfa-sms" />
  );
}

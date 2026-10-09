import type { MfaChallengeProps } from '../../registry';
import { SentCodeChallenge } from '../shared/SentCodeChallenge';

/** 登入的第二步：請伺服器傳送簡訊，輸入收到的 6 位數。 */
export default function SmsChallenge(props: MfaChallengeProps) {
  return <SentCodeChallenge {...props} textPrefix="mfa.sms" testIdPrefix="mfa-sms" />;
}

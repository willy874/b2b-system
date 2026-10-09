import type { MfaChallengeProps } from '../../registry';
import { SentCodeChallenge } from '../shared/SentCodeChallenge';

export default function TelegramChallenge(props: MfaChallengeProps) {
  return <SentCodeChallenge {...props} textPrefix="mfa.telegram" testIdPrefix="mfa-telegram" />;
}

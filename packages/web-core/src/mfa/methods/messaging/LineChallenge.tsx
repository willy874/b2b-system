import type { MfaChallengeProps } from '../../registry';
import { SentCodeChallenge } from '../shared/SentCodeChallenge';

export default function LineChallenge(props: MfaChallengeProps) {
  return <SentCodeChallenge {...props} textPrefix="mfa.line" testIdPrefix="mfa-line" />;
}

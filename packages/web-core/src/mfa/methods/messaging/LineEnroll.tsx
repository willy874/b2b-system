import type { MfaEnrollProps } from '../../registry';
import { MessagingEnroll } from './MessagingEnroll';

export default function LineEnroll(props: MfaEnrollProps) {
  return <MessagingEnroll {...props} textPrefix="mfa.line" testIdPrefix="mfa-line" />;
}

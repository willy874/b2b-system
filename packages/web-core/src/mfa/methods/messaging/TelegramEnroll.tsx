import type { MfaEnrollProps } from '../../registry';
import { MessagingEnroll } from './MessagingEnroll';

export default function TelegramEnroll(props: MfaEnrollProps) {
  return <MessagingEnroll {...props} textPrefix="mfa.telegram" testIdPrefix="mfa-telegram" />;
}

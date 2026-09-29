import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useTranslation } from '@/core/locales';

interface InvitedEmailProps {
  email: string;
}

/** 受邀的 email：唯讀，接受邀請只能用這個信箱。 */
export function InvitedEmail({ email }: InvitedEmailProps) {
  const { t } = useTranslation();
  return (
    <Field label={t('auth.field.email')}>
      <Input type="email" value={email} readOnly data-testid="invitation-email" />
    </Field>
  );
}

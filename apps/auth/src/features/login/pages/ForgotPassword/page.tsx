import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';

import { getForgotPasswordMutationOptions } from '@/apis/auth/forgot-password/mutation';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useTranslation } from '@/core/locales';
import { firstError, zodFormValidator } from '@/shared/hooks';

import { AuthShell } from '../AuthShell';

const Schema = z.object({ email: z.string().min(1).email() });

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const forgot = useMutation(getForgotPasswordMutationOptions());

  const form = useForm({
    defaultValues: { email: '' },
    validators: { onSubmit: zodFormValidator(Schema) },
    onSubmit: async ({ value }) => {
      // 不論 email 是否存在，後端都回 200（帳號列舉防護）
      await forgot.mutateAsync({ params: value }).catch(() => undefined);
      setSent(true);
    },
  });

  return (
    <AuthShell
      title={t('login.forgotPassword.title')}
      description={t('login.forgotPassword.description')}
      footer={
        <a className="text-[var(--color-brand)]" href="/login">
          {t('login.backToLogin')}
        </a>
      }
    >
      {sent ? (
        <p className="text-sm" data-testid="forgot-password-sent">
          {t('login.forgotPassword.sent')}
        </p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="email">
            {(field) => (
              <Field
                label={t('login.field.email')}
                required
                error={firstError(field.state.meta.errors)}
              >
                <Input
                  type="email"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  data-testid="forgot-password-email"
                />
              </Field>
            )}
          </form.Field>
          <Button type="submit" variant="primary" block loading={forgot.isPending}>
            {t('login.forgotPassword.submit')}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

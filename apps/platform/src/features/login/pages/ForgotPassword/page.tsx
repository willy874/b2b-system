import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';

import { getForgotPasswordMutationOptions } from '@/apis/auth/forgot-password/mutation';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { firstError, zodFormValidator } from '@/shared/hooks';

import { ForgotPasswordRoute } from '../../routes';
import { AuthShell } from '../AuthShell';
import { BackToTenantLogin, TenantRequired } from '../TenantLinks';

const Schema = z.object({ email: z.string().min(1).email() });

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const { tenant } = ForgotPasswordRoute.useSearch();
  const [sent, setSent] = useState(false);
  // 物件而不是字串：訊息可能是空字串（語系尚未載入），不能拿它判斷有沒有失敗
  const [formError, setFormError] = useState<{ message: string }>();
  const forgot = useMutation(getForgotPasswordMutationOptions());
  const toMessage = useErrorMessage();

  const form = useForm({
    defaultValues: { email: '' },
    validators: { onSubmit: zodFormValidator(Schema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        // 不論 email 是否存在，後端都回 200（帳號列舉防護）；只有成功才顯示「已寄出」。
        // 限流、租戶無法使用、網路錯誤等失敗要讓使用者知道信沒有寄出，不會洩漏帳號是否存在
        await forgot.mutateAsync({ params: { ...value, tenant: tenant ?? '' } });
        setSent(true);
      } catch (error) {
        setFormError({ message: toMessage(error) });
      }
    },
  });

  if (!tenant) return <TenantRequired title={t('login.forgotPassword.title')} />;

  return (
    <AuthShell
      title={t('login.forgotPassword.title')}
      description={t('login.forgotPassword.description')}
      footer={<BackToTenantLogin tenant={tenant} />}
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
          {formError !== undefined && (
            <p
              className="m-0 text-sm text-[var(--color-danger-text)]"
              role="alert"
              data-testid="forgot-password-error"
            >
              {formError.message}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            block
            loading={forgot.isPending}
            data-testid="forgot-password-submit"
          >
            {t('login.forgotPassword.submit')}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

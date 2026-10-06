import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input, Textarea } from '@b2b-system/ui/Input';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { firstError, zodFormValidator } from '@b2b-system/web-shared/hooks';
import { useForm } from '@tanstack/react-form';
import { useMemo, useState } from 'react';
import { z } from 'zod';

import { useAccountPolicy } from '../../hooks/useAccountPolicy';
import { useRegisterMutation } from '../../hooks/useRegisterMutation';
import { RegisterRoute } from '../../routes';
import { AuthShell } from '../AuthShell';
import { BackToTenantLogin, TenantRequired } from '../TenantLinks';

/** 密碼長度是租戶的設定（`auth.passwordMinLength`）。 */
function createSchema(passwordMinLength: number) {
  return z
    .object({
      email: z.string().trim().min(1).email(),
      displayName: z.string().trim().min(1).max(100),
      password: z.string().min(passwordMinLength),
      confirmPassword: z.string().min(1),
      reason: z.string().trim().max(500),
    })
    .refine((value) => value.password === value.confirmPassword, {
      path: ['confirmPassword'],
      params: { messageKey: 'validation.passwordMismatch' },
    });
}

/**
 * 註冊申請：送出後由管理員在審批頁核准才會建立帳號（docs/rbac/06-approval.md §5）。
 * 不論 email 是否已存在，後端都回同樣的結果（帳號列舉防護），畫面也一律顯示「已送出」。
 */
export default function RegisterPage() {
  const { t } = useTranslation();
  const { tenant } = RegisterRoute.useSearch();
  const register = useRegisterMutation();
  const toMessage = useErrorMessage();
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string>();
  const policy = useAccountPolicy(tenant);
  const schema = useMemo(() => createSchema(policy.passwordMinLength), [policy.passwordMinLength]);

  const form = useForm({
    defaultValues: { email: '', displayName: '', password: '', confirmPassword: '', reason: '' },
    validators: { onSubmit: zodFormValidator(schema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        await register.mutateAsync({
          params: {
            tenant: tenant ?? '',
            email: value.email,
            displayName: value.displayName,
            password: value.password,
            reason: value.reason.trim() || undefined,
          },
        });
        setSubmitted(true);
      } catch (error) {
        // 弱密碼（VALIDATION_FAILED）、限流（RATE_LIMITED）
        setFormError(toMessage(error));
      }
    },
  });

  if (!tenant) return <TenantRequired title={t('login.register.title')} />;
  if (!policy.isLoading && !policy.registrationEnabled) {
    return (
      <AuthShell title={t('login.register.title')} footer={<BackToTenantLogin tenant={tenant} />}>
        <p className="m-0 text-sm" data-testid="register-closed">
          {t('login.register.closed')}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('login.register.title')}
      description={submitted ? undefined : t('login.register.description')}
      footer={<BackToTenantLogin tenant={tenant} />}
    >
      {submitted ? (
        <p className="text-sm" data-testid="register-submitted">
          {t('login.register.submitted')}
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
                  autoComplete="email"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  data-testid="register-email"
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="displayName">
            {(field) => (
              <Field
                label={t('login.field.displayName')}
                required
                error={firstError(field.state.meta.errors)}
              >
                <Input
                  autoComplete="name"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  data-testid="register-display-name"
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="password">
            {(field) => (
              <Field
                label={t('login.field.password')}
                description={t('login.password.hint', { min: policy.passwordMinLength })}
                required
                error={firstError(field.state.meta.errors)}
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  data-testid="register-password"
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="confirmPassword">
            {(field) => (
              <Field
                label={t('login.field.confirmPassword')}
                required
                error={firstError(field.state.meta.errors)}
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  data-testid="register-confirm-password"
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="reason">
            {(field) => (
              <Field label={t('login.register.reason')} error={firstError(field.state.meta.errors)}>
                <Textarea
                  rows={3}
                  maxLength={500}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  placeholder={t('login.register.reasonPlaceholder')}
                  data-testid="register-reason"
                />
              </Field>
            )}
          </form.Field>

          <FormError data-testid="register-error">{formError}</FormError>

          <Button
            type="submit"
            variant="primary"
            block
            loading={register.isPending}
            data-testid="register-submit"
          >
            {t('login.register.submit')}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

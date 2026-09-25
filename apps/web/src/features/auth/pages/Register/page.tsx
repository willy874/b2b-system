import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input, Textarea } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { firstError, zodFormValidator } from '@/shared/hooks';

import { useRegisterMutation } from '../../hooks/useRegisterMutation';
import { AuthShell } from '../AuthShell';

const Schema = z
  .object({
    email: z.string().trim().min(1).email(),
    displayName: z.string().trim().min(1).max(100),
    password: z.string().min(12),
    confirmPassword: z.string().min(1),
    reason: z.string().trim().max(500),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'passwords do not match',
  });

/**
 * 註冊申請：送出後由管理員在審批頁核准才會建立帳號（docs/rbac/06-approval.md §5）。
 * 不論 email 是否已存在，後端都回同樣的結果（帳號列舉防護），畫面也一律顯示「已送出」。
 */
export default function RegisterPage() {
  const { t } = useTranslation();
  const register = useRegisterMutation();
  const toMessage = useErrorMessage();
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string>();

  const form = useForm({
    defaultValues: { email: '', displayName: '', password: '', confirmPassword: '', reason: '' },
    validators: { onSubmit: zodFormValidator(Schema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        await register.mutateAsync({
          params: {
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

  return (
    <AuthShell
      title={t('auth.register.title')}
      description={submitted ? undefined : t('auth.register.description')}
      footer={
        <a className="text-[var(--color-brand)]" href="/auth/login">
          {t('auth.backToLogin')}
        </a>
      }
    >
      {submitted ? (
        <p className="text-sm" data-testid="register-submitted">
          {t('auth.register.submitted')}
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
                label={t('auth.field.email')}
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
                label={t('auth.field.displayName')}
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
                label={t('auth.field.password')}
                description={t('auth.password.hint')}
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
                label={t('auth.field.confirmPassword')}
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
              <Field label={t('auth.register.reason')} error={firstError(field.state.meta.errors)}>
                <Textarea
                  rows={3}
                  maxLength={500}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  placeholder={t('auth.register.reasonPlaceholder')}
                  data-testid="register-reason"
                />
              </Field>
            )}
          </form.Field>

          {formError && (
            <p className="m-0 text-sm text-[var(--color-danger-text)]" data-testid="register-error">
              {formError}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            block
            loading={register.isPending}
            data-testid="register-submit"
          >
            {t('auth.register.submit')}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input, Textarea } from '@b2b-system/ui/Input';
import { useTranslation } from '@b2b-system/web-core/locales';
import { firstError } from '@b2b-system/web-shared/hooks';

import { useRegisterForm } from '../../hooks/useRegisterForm';
import { RegisterRoute } from '../../routes';
import { AuthShell } from '../AuthShell';
import { BackToTenantLogin, TenantRequired } from '../TenantLinks';

/**
 * 註冊申請：送出後由管理員在審批頁核准才會建立帳號（docs/rbac/06-approval.md §5）。
 * 不論 email 是否已存在，後端都回同樣的結果（帳號列舉防護），畫面也一律顯示「已送出」。
 * 流程在 `useRegisterForm`，這裡只渲染。
 */
export default function RegisterPage() {
  const { t } = useTranslation();
  const { tenant } = RegisterRoute.useSearch();
  const { form, policy, closed, submitted, submitting, formError } = useRegisterForm(tenant);

  if (!tenant) return <TenantRequired title={t('login.register.title')} />;
  if (closed) {
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
            loading={submitting}
            data-testid="register-submit"
          >
            {t('login.register.submit')}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

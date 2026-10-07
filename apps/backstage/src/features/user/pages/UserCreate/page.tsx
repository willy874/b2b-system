import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { useTranslation } from '@b2b-system/web-core/locales';
import { firstError } from '@b2b-system/web-shared/hooks';
import { useId } from 'react';

import { UserRoleSelect } from '../../components/UserRoleSelect';
import { useUserCreateForm } from '../../hooks/useUserCreateForm';

/** 新增使用者（對話框即路由）：流程在 `useUserCreateForm`，這裡只渲染。 */
export default function UserCreatePage() {
  const { t } = useTranslation();
  const formId = useId();
  const {
    form,
    canAssignRole,
    roleOptions,
    roleIds,
    setRoleIds,
    serverErrors,
    clearServerError,
    formRef,
    formError,
    submitting,
    close,
  } = useUserCreateForm();

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={t('user.create.title')}
      description={t('user.create.description')}
      data-testid="user-create-dialog"
      footer={
        <>
          <Button onClick={() => close()} data-testid="user-create-cancel">
            {t('common.cancel')}
          </Button>
          {/* 按鈕在 <form> 之外（Dialog 的 footer）：以 form 屬性連回表單，Enter 與點按都走同一個 submit */}
          <Button
            variant="primary"
            type="submit"
            form={formId}
            loading={submitting}
            data-testid="user-create-submit"
          >
            {t('common.create')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="email">
          {(field) => (
            <Field
              label={t('user.field.email')}
              required
              error={firstError(field.state.meta.errors) ?? serverErrors.email}
            >
              <Input
                type="email"
                autoComplete="off"
                maxLength={255}
                value={field.state.value}
                onChange={(event) => {
                  clearServerError('email');
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
                data-testid="user-email-input"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="displayName">
          {(field) => (
            <Field
              label={t('user.field.displayName')}
              required
              error={firstError(field.state.meta.errors) ?? serverErrors.displayName}
            >
              <Input
                maxLength={100}
                value={field.state.value}
                onChange={(event) => {
                  clearServerError('displayName');
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
                data-testid="user-display-name-input"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="username">
          {(field) => (
            <Field
              label={t('user.field.username')}
              error={firstError(field.state.meta.errors) ?? serverErrors.username}
            >
              <Input
                maxLength={50}
                autoComplete="off"
                value={field.state.value}
                onChange={(event) => {
                  clearServerError('username');
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
                data-testid="user-username-input"
              />
            </Field>
          )}
        </form.Field>

        {canAssignRole && (
          <Field label={t('user.field.roles')} error={serverErrors.roleIds}>
            <UserRoleSelect
              roles={roleOptions}
              value={roleIds}
              onValueChange={setRoleIds}
              invalid={Boolean(serverErrors.roleIds)}
              data-testid="user-role-select"
            />
          </Field>
        )}

        <p className="m-0 text-xs text-[var(--color-fg-muted)]">
          {t('user.create.activationHint')}
        </p>
        <FormError>{formError}</FormError>
      </form>
    </Dialog>
  );
}

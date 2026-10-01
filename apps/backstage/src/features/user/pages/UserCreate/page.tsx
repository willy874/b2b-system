import { useForm, useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { z } from 'zod';

import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useErrorMessage, useServerFieldErrors } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useUnsavedChangesGuard } from '@/core/router';
import { firstError, zodFormValidator } from '@/shared/hooks';

import { UserRoleSelect } from '../../components/UserRoleSelect';
import { useUserCreateMutation } from '../../hooks/useUserMutations';
import { useUserPermission } from '../../hooks/useUserPermission';
import { UserCreateRoute, UserListRoute } from '../../routes';

const Schema = z.object({
  email: z.string().trim().email().max(255),
  displayName: z.string().trim().min(1).max(100),
  // 選填：空字串或 3–50 字元。不用 union（錯誤訊息只會是「輸入的值不正確」）
  username: z
    .string()
    .trim()
    .max(50)
    .refine((value) => value === '' || value.length >= 3, {
      params: { messageKey: 'validation.usernameTooShort' },
    }),
});

const FIELDS = ['email', 'displayName', 'username', 'roleIds'] as const;

export default function UserCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = UserCreateRoute.useSearch();
  const permission = useUserPermission();
  const createUser = useUserCreateMutation();
  const toMessage = useErrorMessage();
  const formId = useId();
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string>();
  // Email／使用者名稱重複、後端欄位驗證失敗 → 顯示在該欄位下方並聚焦
  const {
    errors: serverErrors,
    report: reportServerError,
    clear: clearServerError,
    reset: resetServerErrors,
    formRef,
  } = useServerFieldErrors(FIELDS, {
    USER_EMAIL_DUPLICATE: 'email',
    USER_USERNAME_DUPLICATE: 'username',
  });

  const roles = useQuery({ ...getRoleOptionsQueryOptions(), enabled: permission.canReadRoles });
  const close = (options?: { ignoreBlocker?: boolean }) =>
    void navigate({ to: UserListRoute.to, search, ...options });

  const form = useForm({
    defaultValues: { email: '', displayName: '', username: '' },
    validators: { onSubmit: zodFormValidator(Schema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      resetServerErrors();
      try {
        await createUser.mutateAsync({
          params: {
            email: value.email,
            displayName: value.displayName,
            username: value.username || undefined,
            roleIds,
          },
        });
      } catch (error) {
        if (!reportServerError(error)) setFormError(toMessage(error));
        return;
      }
      close({ ignoreBlocker: true });
    },
  });
  const isFormDirty = useStore(form.store, (state) => state.isDirty);
  useUnsavedChangesGuard(isFormDirty || roleIds.length > 0);

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
            loading={createUser.isPending}
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

        {permission.canAssignRole && (
          <Field label={t('user.field.roles')} error={serverErrors.roleIds}>
            <UserRoleSelect
              roles={roles.data?.items}
              value={roleIds}
              onValueChange={(next) => {
                clearServerError('roleIds');
                setRoleIds(next);
              }}
              invalid={Boolean(serverErrors.roleIds)}
              data-testid="user-role-select"
            />
          </Field>
        )}

        <p className="m-0 text-xs text-[var(--color-fg-muted)]">
          {t('user.create.activationHint')}
        </p>
        {/* role="alert"：送出失敗時報讀器會立即念出 */}
        <p role="alert" className="m-0 text-sm text-[var(--color-danger-text)] empty:hidden">
          {formError}
        </p>
      </form>
    </Dialog>
  );
}

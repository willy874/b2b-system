import { useForm, useStore } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Input, Textarea } from '@/components/Input';
import { useErrorMessage, useServerFieldErrors } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useUnsavedChangesGuard } from '@/core/router';
import { firstError, zodFormValidator } from '@/shared/hooks';

import { PermissionSkillTree } from '../../components';
import { useRoleCreateMutation } from '../../hooks/useRoleMutations';
import { RoleCreateRoute, RoleListRoute } from '../../routes';

const Schema = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(500).optional(),
});

const FIELDS = ['name', 'description', 'permissionKeys'] as const;

export default function RoleCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = RoleCreateRoute.useSearch();
  const createRole = useRoleCreateMutation();
  const toMessage = useErrorMessage();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState<string>();
  const formId = useId();
  // 名稱重複、後端欄位驗證失敗 → 顯示在該欄位下方並聚焦
  const {
    errors: serverErrors,
    report: reportServerError,
    clear: clearServerError,
    reset: resetServerErrors,
    formRef,
  } = useServerFieldErrors(FIELDS, { ROLE_NAME_DUPLICATE: 'name' });

  const close = (options?: { ignoreBlocker?: boolean }) =>
    void navigate({ to: RoleListRoute.to, search, ...options });

  const form = useForm({
    defaultValues: { name: '', description: '' },
    validators: { onSubmit: zodFormValidator(Schema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      resetServerErrors();
      try {
        await createRole.mutateAsync({
          params: {
            name: value.name,
            description: value.description || undefined,
            permissionKeys: [...selected] as never,
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
  // 權限挑選器勾了幾十項，一個誤點遮罩就全部歸零：有改動時離開先確認
  useUnsavedChangesGuard(isFormDirty || selected.size > 0);

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={t('role.create.title')}
      description={t('role.create.description')}
      size="xl"
      data-testid="role-create-dialog"
      footer={
        <>
          <Button onClick={() => close()} data-testid="role-create-cancel">
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            loading={createRole.isPending}
            data-testid="role-create-submit"
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
        <form.Field name="name">
          {(field) => (
            <Field
              label={t('role.field.name')}
              required
              error={firstError(field.state.meta.errors) ?? serverErrors.name}
            >
              <Input
                maxLength={64}
                value={field.state.value}
                onChange={(event) => {
                  clearServerError('name');
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
                data-testid="role-name-input"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="description">
          {(field) => (
            <Field
              label={t('role.field.description')}
              error={firstError(field.state.meta.errors) ?? serverErrors.description}
            >
              <Textarea
                maxLength={500}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            </Field>
          )}
        </form.Field>

        <div>
          <p className="mb-2 text-sm font-medium">{t('role.create.permissions')}</p>
          <PermissionSkillTree
            explicit={selected}
            onChange={setSelected}
            data-testid="role-create-permissions"
          />
        </div>

        {/* role="alert"：送出失敗時報讀器會立即念出 */}
        <p role="alert" className="m-0 text-sm text-[var(--color-danger-text)] empty:hidden">
          {formError}
        </p>
      </form>
    </Dialog>
  );
}

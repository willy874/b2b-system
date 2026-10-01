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

import { useGroupCreateMutation } from '../../hooks/useGroupMutations';
import { GroupCreateRoute, GroupDetailRoute, GroupListRoute } from '../../routes';

const Schema = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(500).optional(),
});

const FIELDS = ['name', 'description'] as const;

/** 建立群組：只有名稱與說明；成員與持有的角色在建立後的詳情頁加入（各自有反提權的檢查）。 */
export default function GroupCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = GroupCreateRoute.useSearch();
  const createGroup = useGroupCreateMutation();
  const toMessage = useErrorMessage();
  const [formError, setFormError] = useState<string>();
  const formId = useId();
  const {
    errors: serverErrors,
    report: reportServerError,
    clear: clearServerError,
    reset: resetServerErrors,
    formRef,
  } = useServerFieldErrors(FIELDS, { GROUP_NAME_DUPLICATE: 'name' });

  const close = () => void navigate({ to: GroupListRoute.to, search });

  const form = useForm({
    defaultValues: { name: '', description: '' },
    validators: { onSubmit: zodFormValidator(Schema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      resetServerErrors();
      try {
        const group = await createGroup.mutateAsync({
          params: { name: value.name, description: value.description || undefined },
        });
        // 建立之後直接進詳情加成員
        void navigate({
          to: GroupDetailRoute.to,
          params: { groupId: group.id },
          search,
          ignoreBlocker: true,
        });
      } catch (error) {
        if (!reportServerError(error)) setFormError(toMessage(error));
      }
    },
  });
  const isFormDirty = useStore(form.store, (state) => state.isDirty);
  useUnsavedChangesGuard(isFormDirty);

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={t('group.create.title')}
      description={t('group.create.description')}
      size="md"
      data-testid="group-create-dialog"
      footer={
        <>
          <Button onClick={close} data-testid="group-create-cancel">
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            loading={createGroup.isPending}
            data-testid="group-create-submit"
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
              label={t('group.field.name')}
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
                data-testid="group-name-input"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="description">
          {(field) => (
            <Field
              label={t('group.field.description')}
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

        {/* role="alert"：送出失敗時報讀器會立即念出 */}
        <p role="alert" className="m-0 text-sm text-[var(--color-danger-text)] empty:hidden">
          {formError}
        </p>
      </form>
    </Dialog>
  );
}

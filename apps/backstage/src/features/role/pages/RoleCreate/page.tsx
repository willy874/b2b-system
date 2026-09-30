import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Input, Textarea } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { firstError, zodFormValidator } from '@/shared/hooks';

import { PermissionPicker } from '../../components';
import { useRoleCreateMutation } from '../../hooks/useRoleMutations';
import { RoleCreateRoute, RoleListRoute } from '../../routes';

const Schema = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(500).optional(),
});

export default function RoleCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = RoleCreateRoute.useSearch();
  const createRole = useRoleCreateMutation();
  const toMessage = useErrorMessage();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState<string>();

  const close = () => void navigate({ to: RoleListRoute.to, search });

  const form = useForm({
    defaultValues: { name: '', description: '' },
    validators: { onSubmit: zodFormValidator(Schema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        await createRole.mutateAsync({
          params: {
            name: value.name,
            description: value.description || undefined,
            permissionKeys: [...selected] as never,
          },
        });
        close();
      } catch (error) {
        setFormError(toMessage(error));
      }
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={t('role.create.title')}
      description={t('role.create.description')}
      size="lg"
      data-testid="role-create-dialog"
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={createRole.isPending}
            onClick={() => void form.handleSubmit()}
            data-testid="role-create-submit"
          >
            {t('common.create')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
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
              error={firstError(field.state.meta.errors)}
            >
              <Input
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                data-testid="role-name-input"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="description">
          {(field) => (
            <Field label={t('role.field.description')} error={firstError(field.state.meta.errors)}>
              <Textarea
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            </Field>
          )}
        </form.Field>

        <div>
          <p className="mb-2 text-sm font-medium">{t('role.create.permissions')}</p>
          <PermissionPicker
            selected={selected}
            onToggle={(key, checked) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (checked) next.add(key);
                else next.delete(key);
                return next;
              })
            }
          />
        </div>

        {formError && <p className="m-0 text-sm text-[var(--color-danger-text)]">{formError}</p>}
      </form>
    </Dialog>
  );
}

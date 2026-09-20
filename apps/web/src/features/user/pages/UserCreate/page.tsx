import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { firstError, zodFormValidator } from '@/shared/hooks';

import { useUserCreateMutation } from '../../hooks/useUserMutations';
import { useUserPermission } from '../../hooks/useUserPermission';
import { UserCreateRoute, UserListRoute } from '../../routes';

const Schema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1).max(100),
  username: z.string().trim().min(3).max(50).or(z.literal('')),
});

export default function UserCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = UserCreateRoute.useSearch();
  const permission = useUserPermission();
  const createUser = useUserCreateMutation();
  const toMessage = useErrorMessage();
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState<string>();

  const roles = useQuery({ ...getRoleOptionsQueryOptions(), enabled: permission.canReadRoles });
  const close = () => void navigate({ to: UserListRoute.to, search });

  const form = useForm({
    defaultValues: { email: '', displayName: '', username: '' },
    validators: { onSubmit: zodFormValidator(Schema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        await createUser.mutateAsync({
          params: {
            email: value.email,
            displayName: value.displayName,
            username: value.username || undefined,
            roleIds: [...roleIds],
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
      title={t('user.create.title')}
      description={t('user.create.description')}
      data-testid="user-create-dialog"
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={createUser.isPending}
            onClick={() => void form.handleSubmit()}
            data-testid="user-create-submit"
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
        <form.Field name="email">
          {(field) => (
            <Field
              label={t('user.field.email')}
              required
              error={firstError(field.state.meta.errors)}
            >
              <Input
                type="email"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
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
              error={firstError(field.state.meta.errors)}
            >
              <Input
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                data-testid="user-display-name-input"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="username">
          {(field) => (
            <Field label={t('user.field.username')} error={firstError(field.state.meta.errors)}>
              <Input
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            </Field>
          )}
        </form.Field>

        {permission.canAssignRole && (
          <div>
            <p className="mb-2 text-sm font-medium">{t('user.field.roles')}</p>
            <div className="flex flex-col gap-2">
              {roles.data?.items.map((role) => (
                <Checkbox
                  key={role.id}
                  checked={roleIds.has(role.id)}
                  onCheckedChange={(checked) =>
                    setRoleIds((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(role.id);
                      else next.delete(role.id);
                      return next;
                    })
                  }
                  label={role.name}
                  description={role.slug}
                  data-testid={`user-role-checkbox-${role.slug}`}
                />
              ))}
            </div>
          </div>
        )}

        <p className="m-0 text-xs text-[var(--color-fg-muted)]">
          {t('user.create.activationHint')}
        </p>
        {formError && <p className="m-0 text-sm text-[var(--color-danger)]">{formError}</p>}
      </form>
    </Dialog>
  );
}

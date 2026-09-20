import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { getRoleDetailQueryOptions } from '@/apis/role/get-role-detail/query';
import { getRolePermissionsQueryOptions } from '@/apis/role/get-role-permissions/query';
import { getRoleUsersQueryOptions } from '@/apis/role/get-role-users/query';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Input, Textarea } from '@/components/Input';
import { Skeleton } from '@/components/Skeleton';
import { useTranslation } from '@/core/locales';
import { DEFAULT_USER_SEARCH } from '@/features/user/routes';

import { useRoleDuplicateMutation, useRoleUpdateMutation } from '../../hooks/useRoleMutations';
import { useRolePermission } from '../../hooks/useRolePermission';
import { RoleDetailPermissionRoute, RoleDetailRoute, RoleListRoute } from '../../routes';
import { ExternalRoutes } from '../../routes';

export default function RoleDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { roleId } = RoleDetailRoute.useParams();
  const search = RoleListRoute.useSearch();
  const permission = useRolePermission();

  const role = useQuery(getRoleDetailQueryOptions(roleId));
  const rolePermissions = useQuery({
    ...getRolePermissionsQueryOptions(roleId),
    enabled: permission.canManagePermission || permission.canRead,
  });
  const holders = useQuery({
    ...getRoleUsersQueryOptions(roleId),
    enabled: permission.canViewUsers,
  });

  const updateRole = useRoleUpdateMutation();
  const duplicateRole = useRoleDuplicateMutation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const close = () => void navigate({ to: RoleListRoute.to, search });
  const isSystem = role.data?.isSystem ?? false;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={role.data?.name ?? t('role.detail.title')}
      description={role.data ? `${role.data.slug}` : undefined}
      size="lg"
      data-testid="role-detail-dialog"
      footer={
        <>
          {permission.canCreate && role.data && (
            <Button
              onClick={() =>
                void duplicateRole
                  .mutateAsync({ params: { roleId, body: {} } })
                  .catch(() => undefined)
              }
              loading={duplicateRole.isPending}
              data-testid="role-duplicate-button"
            >
              {t('role.duplicate.action')}
            </Button>
          )}
          {permission.canManagePermission && !isSystem && (
            <Button
              variant="secondary"
              onClick={() =>
                void navigate({ to: RoleDetailPermissionRoute.to, params: { roleId }, search })
              }
              data-testid="role-manage-permission-button"
            >
              {t('role.detail.managePermission')}
            </Button>
          )}
          <Button variant="primary" onClick={close}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      {role.isPending && <Skeleton height={160} />}

      {role.data && (
        <div className="flex flex-col gap-5">
          <section>
            <div className="flex items-center justify-between">
              <h3 className="m-0 text-sm font-semibold">{t('role.detail.basic')}</h3>
              {permission.canUpdate && !isSystem && !editing && (
                <Button
                  size="sm"
                  onClick={() => {
                    setName(role.data.name);
                    setDescription(role.data.description ?? '');
                    setEditing(true);
                  }}
                  data-testid="role-edit-button"
                >
                  {t('common.edit')}
                </Button>
              )}
            </div>

            {editing ? (
              <div className="mt-2 flex flex-col gap-3">
                <Field label={t('role.field.name')} required>
                  <Input value={name} onChange={(event) => setName(event.target.value)} />
                </Field>
                <Field label={t('role.field.description')}>
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button size="sm" onClick={() => setEditing(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={updateRole.isPending}
                    onClick={async () => {
                      await updateRole
                        .mutateAsync({ params: { roleId, body: { name, description } } })
                        .catch(() => undefined);
                      setEditing(false);
                    }}
                    data-testid="role-save-button"
                  >
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            ) : (
              <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
                <dt className="text-[var(--color-fg-muted)]">{t('role.field.description')}</dt>
                <dd className="m-0">{role.data.description || '-'}</dd>
                <dt className="text-[var(--color-fg-muted)]">{t('role.field.type')}</dt>
                <dd className="m-0">
                  {isSystem ? (
                    <Chip tone="brand">{t('role.type.system')}</Chip>
                  ) : (
                    <Chip tone="neutral">{t('role.type.custom')}</Chip>
                  )}
                </dd>
              </dl>
            )}
          </section>

          <section>
            <h3 className="m-0 text-sm font-semibold">{t('role.detail.permissions')}</h3>
            <div className="mt-2 flex flex-wrap gap-1" data-testid="role-permission-chips">
              {role.data.slug === 'super-admin' ? (
                <Chip tone="brand">{t('role.detail.allPermissions')}</Chip>
              ) : rolePermissions.data?.permissions.length ? (
                rolePermissions.data.permissions.map((item) => (
                  <Chip key={item.key} tone="neutral">
                    {t(item.nameI18nKey)}
                  </Chip>
                ))
              ) : (
                <span className="text-sm text-[var(--color-fg-muted)]">{t('common.none')}</span>
              )}
            </div>
          </section>

          {permission.canViewUsers && (
            <section>
              <h3 className="m-0 text-sm font-semibold">{t('role.detail.holders')}</h3>
              <ul className="mt-2 flex list-none flex-col gap-1 p-0 text-sm">
                {holders.data?.items.length ? (
                  holders.data.items.map((holder) => (
                    <li key={holder.id}>
                      <Link
                        to={ExternalRoutes.UserDetailRoute.to}
                        params={{ userId: holder.id }}
                        search={DEFAULT_USER_SEARCH}
                        className="text-[var(--color-brand)]"
                      >
                        {holder.displayName}
                      </Link>
                      <span className="ml-2 text-[var(--color-fg-muted)]">{holder.email}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-[var(--color-fg-muted)]">{t('common.none')}</li>
                )}
              </ul>
            </section>
          )}
        </div>
      )}

      <Outlet />
    </Dialog>
  );
}

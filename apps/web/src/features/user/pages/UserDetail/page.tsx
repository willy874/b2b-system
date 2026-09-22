import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';
import { getUserDetailQueryOptions } from '@/apis/user/get-user-detail/query';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { Chip } from '@/components/Chip';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Skeleton } from '@/components/Skeleton';
import { Tooltip } from '@/components/Tooltip';
import { useTranslation } from '@/core/locales';
import { formatDateTime } from '@/shared/date';

import { useAssignUserRolesMutation, useUserUpdateMutation } from '../../hooks/useUserMutations';
import { useUserPermission } from '../../hooks/useUserPermission';
import { UserDetailRoute, UserListRoute } from '../../routes';

export default function UserDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { userId } = UserDetailRoute.useParams();
  const search = UserListRoute.useSearch();
  const permission = useUserPermission();

  const profile = useQuery(getAuthProfileQueryOptions());
  const user = useQuery(getUserDetailQueryOptions(userId));
  const roles = useQuery({ ...getRoleOptionsQueryOptions(), enabled: permission.canReadRoles });

  const isSelf = profile.data?.user.id === userId;
  const updateUser = useUserUpdateMutation();
  const assignRoles = useAssignUserRolesMutation(userId, isSelf);

  const initialRoleIds = useMemo(
    () => new Set((user.data?.roles ?? []).map((role) => role.id)),
    [user.data],
  );
  const [draftRoleIds, setDraftRoleIds] = useState<Set<string>>();
  const selectedRoleIds = draftRoleIds ?? initialRoleIds;
  const setSelectedRoleIds = (updater: (previous: Set<string>) => Set<string>) =>
    setDraftRoleIds((previous) => updater(previous ?? initialRoleIds));

  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState<'pending' | 'active' | 'inactive'>('active');
  const [editing, setEditing] = useState(false);

  const close = () => void navigate({ to: UserListRoute.to, search });
  const rolesDirty =
    selectedRoleIds.size !== initialRoleIds.size ||
    [...selectedRoleIds].some((id) => !initialRoleIds.has(id));

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={user.data?.displayName ?? t('user.detail.title')}
      description={user.data?.email}
      size="lg"
      data-testid="user-detail-dialog"
      footer={
        <Button variant="primary" onClick={close}>
          {t('common.close')}
        </Button>
      }
    >
      {user.isPending && <Skeleton height={200} />}

      {user.data && (
        <div className="flex flex-col gap-5">
          <section>
            <div className="flex items-center justify-between">
              <h3 className="m-0 text-sm font-semibold">{t('user.detail.basic')}</h3>
              {permission.canUpdate && !editing && (
                <Tooltip content={isSelf ? t('user.detail.selfHint') : ''}>
                  <Button
                    size="sm"
                    disabled={isSelf}
                    // 停用的理由在外層 Tooltip 裡，按鈕要保持可聚焦才讀得到
                    focusableWhenDisabled
                    onClick={() => {
                      setDisplayName(user.data.displayName);
                      setStatus(user.data.status === 'locked' ? 'active' : user.data.status);
                      setEditing(true);
                    }}
                    data-testid="user-edit-button"
                  >
                    {t('common.edit')}
                  </Button>
                </Tooltip>
              )}
            </div>

            {editing ? (
              <div className="mt-2 flex flex-col gap-3">
                <Field label={t('user.field.displayName')} required>
                  <Input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </Field>
                <Field label={t('user.field.status')}>
                  <Select
                    value={status}
                    onValueChange={(value) => setStatus(value as typeof status)}
                    options={[
                      { value: 'active', label: t('user.status.active') },
                      { value: 'inactive', label: t('user.status.inactive') },
                      { value: 'pending', label: t('user.status.pending') },
                    ]}
                  />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button size="sm" onClick={() => setEditing(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={updateUser.isPending}
                    onClick={async () => {
                      await updateUser
                        .mutateAsync({ params: { userId, body: { displayName, status } } })
                        .catch(() => undefined);
                      setEditing(false);
                    }}
                    data-testid="user-save-button"
                  >
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            ) : (
              <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
                <dt className="text-[var(--color-fg-muted)]">{t('user.field.status')}</dt>
                <dd className="m-0">
                  <Chip tone={user.data.status === 'active' ? 'success' : 'neutral'}>
                    {t(`user.status.${user.data.status}`)}
                  </Chip>
                </dd>
                <dt className="text-[var(--color-fg-muted)]">{t('user.field.username')}</dt>
                <dd className="m-0">{user.data.username ?? '-'}</dd>
                <dt className="text-[var(--color-fg-muted)]">{t('user.field.lastLoginAt')}</dt>
                <dd className="m-0">{formatDateTime(user.data.lastLoginAt)}</dd>
                <dt className="text-[var(--color-fg-muted)]">{t('user.field.createdAt')}</dt>
                <dd className="m-0">{formatDateTime(user.data.createdAt)}</dd>
              </dl>
            )}
          </section>

          <section>
            <h3 className="m-0 text-sm font-semibold">{t('user.detail.roles')}</h3>
            {permission.canAssignRole && !isSelf ? (
              <div className="mt-2 flex flex-col gap-2" data-testid="user-role-picker">
                {roles.data?.items.map((role) => (
                  <Checkbox
                    key={role.id}
                    checked={selectedRoleIds.has(role.id)}
                    onCheckedChange={(checked) =>
                      setSelectedRoleIds((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(role.id);
                        else next.delete(role.id);
                        return next;
                      })
                    }
                    label={role.name}
                    description={role.slug}
                    data-testid={`user-detail-role-${role.slug}`}
                  />
                ))}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!rolesDirty}
                    loading={assignRoles.isPending}
                    onClick={() =>
                      void assignRoles
                        .mutateAsync({
                          params: { userId, body: { roleIds: [...selectedRoleIds] } },
                        })
                        .catch(() => undefined)
                    }
                    data-testid="user-assign-roles-button"
                  >
                    {t('user.assignRole.action')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1">
                {user.data.roles.length ? (
                  user.data.roles.map((role) => (
                    <Chip key={role.id} tone={role.isSystem ? 'brand' : 'neutral'}>
                      {role.name}
                    </Chip>
                  ))
                ) : (
                  <span className="text-sm text-[var(--color-fg-muted)]">{t('common.none')}</span>
                )}
              </div>
            )}
            {isSelf && (
              <p className="mt-2 text-xs text-[var(--color-fg-muted)]">
                {t('user.detail.selfHint')}
              </p>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

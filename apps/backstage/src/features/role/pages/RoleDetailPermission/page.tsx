import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { getRolePermissionsQueryOptions } from '@/apis/role/get-role-permissions/query';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { useTranslation } from '@/core/locales';

import { PermissionPicker } from '../../components';
import { useGrantRolePermissionsMutation } from '../../hooks/useRoleMutations';
import { useRolePermission } from '../../hooks/useRolePermission';
import { RoleDetailPermissionRoute, RoleDetailRoute, RoleListRoute } from '../../routes';

export default function RoleDetailPermissionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { roleId } = RoleDetailPermissionRoute.useParams();
  const search = RoleListRoute.useSearch();
  const permission = useRolePermission();
  const current = useQuery(getRolePermissionsQueryOptions(roleId));
  const grant = useGrantRolePermissionsMutation();

  const initial = useMemo(
    () => new Set<string>((current.data?.permissions ?? []).map((item) => String(item.key))),
    [current.data],
  );
  // 資料還沒回來之前沒有草稿；使用者勾選後才有。不用 effect 同步，避免串連渲染。
  const [draft, setDraft] = useState<Set<string>>();
  const selected = draft ?? initial;
  const setSelected = (updater: (previous: Set<string>) => Set<string>) =>
    setDraft((previous) => updater(previous ?? initial));

  const close = () => void navigate({ to: RoleDetailRoute.to, params: { roleId }, search });

  const add = [...selected].filter((key) => !initial.has(key));
  const remove = [...initial].filter((key) => !selected.has(key));
  const dirty = add.length > 0 || remove.length > 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={t('role.permission.title')}
      description={t('role.permission.description')}
      size="lg"
      data-testid="role-permission-dialog"
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!dirty || !permission.canGrantPermission}
            loading={grant.isPending}
            onClick={async () => {
              await grant
                .mutateAsync({
                  params: { roleId, body: { add: add as never, remove: remove as never } },
                })
                .catch(() => undefined);
              close();
            }}
            data-testid="role-permission-save"
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <PermissionPicker
        selected={selected}
        disabled={!permission.canGrantPermission}
        onToggle={(key, checked) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (checked) next.add(key);
            else next.delete(key);
            return next;
          })
        }
        data-testid="role-permission-picker"
      />
    </Dialog>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { getRoleListQueryOptions } from '@/apis/role/get-role-list/query';
import { AlertDialog } from '@/components/AlertDialog';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Pagination } from '@/components/Pagination';
import { useTranslation } from '@/core/locales';

import { useRoleDeleteMutation } from '../../hooks/useRoleMutations';
import { useRolePermission } from '../../hooks/useRolePermission';
import { RoleCreateRoute, RoleDetailRoute } from '../../routes';
import { toRoleRowVM } from './adapter';
import type { RoleRowVM } from './adapter';
import { RoleTable } from './components/RoleTable';
import { useRoleSearchFilter } from './useRoleSearchFilter';

export default function RoleListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const permission = useRolePermission();
  const { search, setKeyword, setSort, setPage } = useRoleSearchFilter();
  const [keywordDraft, setKeywordDraft] = useState(search.keyword ?? '');
  const [pendingDelete, setPendingDelete] = useState<RoleRowVM>();
  const deleteRole = useRoleDeleteMutation();

  const { data, isPending } = useQuery(
    getRoleListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        keyword: search.keyword,
        sortBy: search.sortBy,
        sortOrder: search.sortOrder,
      },
    }),
  );

  const rows = useMemo(
    () => (data?.items ?? []).map((role) => toRoleRowVM(role, permission)),
    [data, permission],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="role-list-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('role.list.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('role.list.description')}</p>
        </div>
        {/* 使用者永遠不會有這個權限時直接隱藏 */}
        {permission.canCreate && (
          <Button
            variant="primary"
            onClick={() => void navigate({ to: RoleCreateRoute.to, search })}
            data-testid="role-create-button"
          >
            {t('role.create.action')}
          </Button>
        )}
      </header>

      <div className="flex gap-2">
        <Input
          placeholder={t('role.list.searchPlaceholder')}
          value={keywordDraft}
          onChange={(event) => setKeywordDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setKeyword(keywordDraft);
          }}
          className="max-w-xs"
          data-testid="role-search-input"
        />
        <Button onClick={() => setKeyword(keywordDraft)}>{t('common.search')}</Button>
      </div>

      <RoleTable
        rows={rows}
        loading={isPending}
        search={search}
        onSortingChange={setSort}
        onRowDoubleClick={(row) =>
          void navigate({ to: RoleDetailRoute.to, params: { roleId: row.id }, search })
        }
        onDelete={setPendingDelete}
      />

      <Pagination
        offset={search.offset}
        limit={search.limit}
        total={data?.pagination.total ?? 0}
        onChange={({ offset, limit }) => setPage(offset, limit)}
        labels={{
          previous: t('common.previous'),
          next: t('common.next'),
          summary: ({ from, to, total }) => `${from}-${to} / ${total}`,
        }}
      />

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(undefined)}
        title={t('role.delete.title')}
        description={t('role.delete.confirm', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={deleteRole.isPending}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteRole
            .mutateAsync({ params: { roleId: pendingDelete.id } })
            .catch(() => undefined);
          setPendingDelete(undefined);
        }}
      />

      {/* 對話框子路由（建立／詳情）掛在列表頁內，列表在背後保持掛載 */}
      <Outlet />
    </div>
  );
}

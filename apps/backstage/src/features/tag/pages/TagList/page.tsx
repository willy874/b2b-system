import { AlertDialog } from '@b2b-system/ui/AlertDialog';
import { Button, IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { Tabs } from '@b2b-system/ui/Tabs';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { RichTable } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { getTagListQueryOptions } from '@/apis/tag/get-tag-list/query';
import type { TagScope } from '@/apis/tag/types';
import { TagChips } from '@/core/components';
import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';
import type { Tag } from '@/shared/api-sdk';

import {
  TAG_COLOR_LABEL_KEY,
  TAG_SCOPE_DESCRIPTION_KEY,
  TAG_SCOPE_FEATURE,
  TAG_SCOPE_LABEL_KEY,
} from '../../constants';
import {
  useTagCreateMutation,
  useTagDeleteMutation,
  useTagUpdateMutation,
} from '../../hooks/useTagMutations';
import { useTagPermission } from '../../hooks/useTagPermission';
import { TAG_SCOPES, TagListRoute } from '../../routes';
import { TagFormDialog } from './components/TagFormDialog';

/**
 * 標籤管理（docs/architecture/backend/18-tag.md §7.2 D1、D5）：每個標籤組一個分頁。檔案組跟著 feature `file`，沒啟用時不出現。
 * 貼與移除在各資源的頁面上做（檔案管理器、使用者），這裡只管定義。
 */
export default function TagListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: TagListRoute.fullPath });
  const { scope: requested } = TagListRoute.useSearch();
  const permission = useTagPermission();
  const fileReady = useIsFeatureReady(TenantFeature.file);
  const scopes = TAG_SCOPES.filter(
    (scope) => TAG_SCOPE_FEATURE[scope] !== TenantFeature.file || fileReady,
  );
  const scope: TagScope = scopes.includes(requested) ? requested : (scopes[0] ?? 'user');

  const queryClient = useQueryClient();
  const tags = useQuery(getTagListQueryOptions(scope));
  const create = useTagCreateMutation();
  const update = useTagUpdateMutation();
  const remove = useTagDeleteMutation();
  const [editing, setEditing] = useState<Tag | 'new'>();
  const [pendingDelete, setPendingDelete] = useState<Tag>();

  /** 版本衝突後重新載入：重抓列表，換成最新的那一筆（含 `version`）；已被刪除就關掉對話框。 */
  const reloadEditing = async () => {
    if (editing === undefined || editing === 'new') return;
    const latest = await queryClient.fetchQuery({ ...getTagListQueryOptions(scope), staleTime: 0 });
    setEditing(latest.items.find((item) => item.id === editing.id));
  };

  const columns = useMemo<Array<TableColumnDef<Tag>>>(
    () => [
      {
        id: 'name',
        header: t('tagAdmin.field.name'),
        enableSorting: false,
        cell: ({ row }) => <TagChips tags={[row.original]} />,
      },
      {
        id: 'color',
        header: t('tagAdmin.field.color'),
        enableSorting: false,
        cell: ({ row }) => t(TAG_COLOR_LABEL_KEY[row.original.color]),
      },
      {
        id: 'updatedAt',
        header: t('tagAdmin.field.updatedAt'),
        enableSorting: false,
        cell: ({ row }) => formatDateTime(row.original.updatedAt),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-1">
            {permission.canUpdate && (
              <Tooltip content={t('common.edit')}>
                <IconButton
                  size="sm"
                  aria-label={t('common.edit')}
                  onClick={() => setEditing(row.original)}
                  data-testid="tag-edit-button"
                  data-value={row.original.id}
                >
                  <Icon name="edit" size={16} />
                </IconButton>
              </Tooltip>
            )}
            {permission.canDelete && (
              <Tooltip content={t('common.delete')}>
                <IconButton
                  size="sm"
                  aria-label={t('common.delete')}
                  onClick={() => setPendingDelete(row.original)}
                  data-testid="tag-delete-button"
                  data-value={row.original.id}
                >
                  <Icon name="trash" size={16} />
                </IconButton>
              </Tooltip>
            )}
          </div>
        ),
      },
    ],
    [permission.canDelete, permission.canUpdate, setEditing, setPendingDelete, t],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="tag-list-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('tagAdmin.list.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            {t('tagAdmin.list.description')}
          </p>
        </div>
        {permission.canCreate && (
          <Button
            variant="primary"
            onClick={() => setEditing('new')}
            data-testid="tag-create-button"
          >
            {t('tagAdmin.create.action')}
          </Button>
        )}
      </header>

      <Tabs
        moreLabel={t('common.more')}
        value={scope}
        onValueChange={(value) =>
          void navigate({ to: TagListRoute.to, search: { scope: value as TagScope } })
        }
        tabs={scopes.map((value) => ({ value, label: t(TAG_SCOPE_LABEL_KEY[value]) }))}
        data-testid="tag-scope-tabs"
      />
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">
        {t(TAG_SCOPE_DESCRIPTION_KEY[scope])}
      </p>

      <RichTable
        data={tags.data?.items ?? []}
        columns={columns}
        loading={tags.isPending}
        getRowId={getRowId}
        enableRowSelection={false}
        error={tags.error}
        onRetry={() => void tags.refetch()}
        data-testid="tag-table"
      />

      <TagFormDialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        tag={editing === 'new' ? undefined : editing}
        onSubmit={(values) =>
          editing === 'new' || editing === undefined
            ? create.mutateAsync({ params: { scope, ...values } })
            : update.mutateAsync({
                params: { tagId: editing.id, body: { ...values, version: editing.version } },
              })
        }
        onReload={reloadEditing}
      />

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(undefined)}
        title={t('tagAdmin.delete.title')}
        description={t('tagAdmin.delete.confirm', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await remove.mutateAsync({ params: { tagId: pendingDelete.id } });
          } catch {
            // 錯誤由 mutation 的 onError 顯示；對話框留著讓使用者重試或取消
            return;
          }
          setPendingDelete(undefined);
        }}
        data-testid="tag-delete-confirm"
      />
    </div>
  );
}

const getRowId = (row: Tag) => row.id;

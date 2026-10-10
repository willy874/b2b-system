import { Button } from '@b2b-system/ui/Button';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { PageHeader } from '@b2b-system/ui/PageHeader';
import { Tabs } from '@b2b-system/ui/Tabs';
import { ExportDialog } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { getTagListQueryOptions } from '@/apis/tag/get-tag-list/query';
import type { TagScope } from '@/apis/tag/types';
import { TransferActions } from '@/core/components/TransferActions';
import { useFeatureReadiness } from '@/core/feature';
import type { Tag } from '@/shared/api-sdk';

import { TAG_SCOPE_DESCRIPTION_KEY, TAG_SCOPE_FEATURE, TAG_SCOPE_LABEL_KEY } from '../../constants';
import { tagExportApi } from '../../hooks/tagTransferApi';
import {
  useTagCreateMutation,
  useTagDeleteMutation,
  useTagUpdateMutation,
} from '../../hooks/useTagMutations';
import { useTagPermission } from '../../hooks/useTagPermission';
import { TAG_SCOPES, TagImportRoute, TagListRoute } from '../../routes';
import { TagFormDialog } from './components/TagFormDialog';
import { TagTable } from './components/TagTable';

/**
 * 標籤管理（docs/architecture/backend/18-tag.md §7.2 D1、D5）：每個標籤組一個分頁。檔案組跟著 feature `file`、圖片庫組跟著 `gallery`，沒啟用時不出現。
 * 貼與移除在各資源的頁面上做（檔案管理器、使用者），這裡只管定義。
 */
export default function TagListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: TagListRoute.fullPath });
  const { scope: requested } = TagListRoute.useSearch();
  const permission = useTagPermission();
  // 標籤組所屬的 feature 沒啟用就不出現（TAG_SCOPE_FEATURE 加一組時這裡不必跟著改）
  const isReady = useFeatureReadiness();
  const scopes = TAG_SCOPES.filter((scope) => isReady(TAG_SCOPE_FEATURE[scope] ?? null));
  const scope: TagScope = scopes.includes(requested) ? requested : (scopes[0] ?? 'user');

  const queryClient = useQueryClient();
  const toast = useToast();
  const tags = useQuery(getTagListQueryOptions(scope));
  const create = useTagCreateMutation();
  const update = useTagUpdateMutation();
  const { mutateAsync: removeTag } = useTagDeleteMutation();
  const confirm = useConfirm();
  // 失敗時對話框留著讓使用者重試或取消，錯誤由 mutation 的 onError 顯示（docs/architecture/frontend/07-ui-system.md §3.11）
  const confirmDelete = (tag: Tag) =>
    void confirm({
      title: t('tagAdmin.delete.title'),
      description: t('tagAdmin.delete.confirm', { name: tag.name }),
      confirmLabel: t('common.delete'),
      tone: 'danger',
      onConfirm: () => removeTag({ params: { tagId: tag.id } }),
      'data-testid': 'tag-delete-confirm',
    });
  const [editing, setEditing] = useState<Tag | 'new'>();
  /** 匯出目前的標籤組（docs/architecture/backend/22-data-transfer.md §12.4）。 */
  const [exporting, setExporting] = useState(false);

  /** 版本衝突後重新載入：重抓列表，換成最新的那一筆（含 `version`）；已被別人刪除時說明原因再關掉對話框。 */
  const reloadEditing = async () => {
    if (editing === undefined || editing === 'new') return;
    const latest = await queryClient.fetchQuery({ ...getTagListQueryOptions(scope), staleTime: 0 });
    const found = latest.items.find((item) => item.id === editing.id);
    if (!found) toast.info(t('tagAdmin.edit.deleted', { name: editing.name }));
    setEditing(found);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="tag-list-page">
      <PageHeader
        title={t('tagAdmin.list.title')}
        description={t('tagAdmin.list.description')}
        actions={
          <>
            <TransferActions
              exports={
                permission.canExport ? [{ key: 'tag', onSelect: () => setExporting(true) }] : []
              }
              imports={
                permission.canImport
                  ? [{ key: 'tag', to: TagImportRoute.to, search: { mode: 'create' } }]
                  : []
              }
              testIds={{ exportButton: 'tag-export-button', importButton: 'tag-import-button' }}
            />
            {permission.canCreate && (
              <Button
                variant="primary"
                onClick={() => setEditing('new')}
                data-testid="tag-create-button"
              >
                {t('tagAdmin.create.action')}
              </Button>
            )}
          </>
        }
      />

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

      <TagTable
        items={tags.data?.items ?? []}
        loading={tags.isPending}
        error={tags.error}
        onRetry={() => void tags.refetch()}
        canUpdate={permission.canUpdate}
        canDelete={permission.canDelete}
        onEdit={setEditing}
        onDelete={confirmDelete}
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

      <ExportDialog
        open={exporting}
        onOpenChange={setExporting}
        api={tagExportApi}
        type="tag"
        filter={{ scope }}
        matchingTotal={tags.data?.items.length ?? 0}
        data-testid="tag-export-dialog"
      />
    </div>
  );
}

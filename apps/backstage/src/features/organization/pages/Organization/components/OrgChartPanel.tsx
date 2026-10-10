import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { FormError } from '@b2b-system/ui/FormError';
import { Icon } from '@b2b-system/ui/Icon';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { TreeEditor } from '@b2b-system/ui/TreeEditor';
import { QueryError } from '@b2b-system/web-core/components';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';
import type { OrgUnit } from '@/shared/api-sdk';

import { useOrgChartEditor } from '../../../hooks/useOrgChartEditor';
import type { useOrgUnitPermission } from '../../../hooks/useOrgUnitPermission';
import { createOrgChartNode, isNewNodeId, isWithinDepth, renameNode } from '../orgChart';
import type { OrgChartNodeData, OrgChartSaveFailure } from '../orgChart';
import { OrgChartRenameDialog } from './OrgChartRenameDialog';
import type { OrgChartRenameTarget } from './OrgChartRenameDialog';

/** 節點的尺寸：名稱、主管、人數三行。 */
const NODE_SIZE = { width: 200, height: 76 };

const SAVE_STEP_LABEL_KEY = {
  create: 'organization.chart.step.create',
  rename: 'organization.chart.step.rename',
  move: 'organization.chart.step.move',
  delete: 'organization.chart.step.delete',
} as const satisfies Record<OrgChartSaveFailure['step'], string>;

interface OrgChartPanelProps {
  units: OrgUnit[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  selectedId: string | undefined;
  /** 檢視模式點節點：在下方顯示那個部門的詳情。 */
  onSelect: (id: string) => void;
  permission: ReturnType<typeof useOrgUnitPermission>;
  /** 選中部門的詳情，畫在組織圖下方；編輯模式不顯示（詳情裡的操作會直接改伺服器，與草稿衝突）。 */
  detail?: ReactNode;
}

/**
 * 組織圖（docs/architecture/backend/23-organization.md §8）：以 TreeEditor 畫出部門樹（自動排版、根在上）。
 * 有編輯權限時可以進入編輯模式：新增下層、雙擊改名、從節點拖線到另一個節點換上層、刪除；改的都是草稿，按「儲存」才依序送出。
 */
export function OrgChartPanel({
  units,
  loading,
  error,
  onRetry,
  selectedId,
  onSelect,
  permission,
  detail,
}: OrgChartPanelProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  // 回收桶被平台關掉時，確認文字不提「成員資格隨部門進回收桶」
  const deleteConfirmKeys = useIsFeatureReady(TenantFeature.trash)
    ? ({
        withChildren: 'organization.chart.deleteConfirmWithChildren',
        plain: 'organization.chart.deleteConfirm',
      } as const)
    : ({
        withChildren: 'organization.chart.deleteConfirmWithChildrenNoTrash',
        plain: 'organization.chart.deleteConfirmNoTrash',
      } as const);
  const toMessage = useErrorMessage();
  const editor = useOrgChartEditor(units);
  const [renaming, setRenaming] = useState<OrgChartRenameTarget>();
  useUnsavedChangesGuard(editor.isDirty);

  const { hydrated, canCreate, canUpdate, canDelete } = permission;
  const canEdit = hydrated && (canCreate || canUpdate || canDelete);
  const highlighted = useMemo(
    () => new Set(selectedId && !editor.editing ? [selectedId] : []),
    [selectedId, editor.editing],
  );

  if (loading) return <Skeleton height={480} />;
  if (error && !units) return <QueryError error={error} onRetry={onRetry} />;

  const cancel = async () => {
    if (editor.isDirty) {
      const confirmed = await confirm({
        title: t('organization.chart.cancelTitle'),
        description: t('organization.chart.cancelConfirm', { count: editor.changeCount }),
        confirmLabel: t('organization.chart.discard'),
        tone: 'danger',
        'data-testid': 'org-chart-cancel-confirm',
      });
      if (!confirmed) return;
    }
    editor.cancel();
  };

  const save = async () => {
    if (await editor.save()) toast.success(t('organization.chart.saved'));
  };

  const canRename = (id: string) => (isNewNodeId(id) ? canCreate : canUpdate);

  return (
    <section className="flex min-h-0 flex-col gap-3" data-testid="org-chart">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm text-[var(--color-fg-muted)]">
          {editor.editing ? t('organization.chart.editHint') : t('organization.chart.viewHint')}
        </p>
        <div className="flex items-center gap-2">
          {editor.editing ? (
            <>
              <Chip
                tone={editor.changeCount ? 'warning' : 'neutral'}
                data-testid="org-chart-change-count"
                data-value={editor.changeCount}
              >
                {t('organization.chart.changes', { count: editor.changeCount })}
              </Chip>
              <Button
                onClick={() => void cancel()}
                disabled={editor.saving}
                data-testid="org-chart-cancel"
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                loading={editor.saving}
                disabled={!editor.changeCount || editor.blankIds.length > 0}
                onClick={() => void save()}
                data-testid="org-chart-save"
              >
                {t('organization.chart.save')}
              </Button>
            </>
          ) : (
            canEdit && (
              <Button
                startIcon={<Icon name="edit" size={16} />}
                onClick={editor.start}
                data-testid="org-chart-edit"
              >
                {t('organization.chart.edit')}
              </Button>
            )
          )}
        </div>
      </div>

      {editor.failure && (
        <FormError data-testid="org-chart-save-failure">
          {t('organization.chart.saveFailed', {
            step: t(SAVE_STEP_LABEL_KEY[editor.failure.step]),
            name: editor.failure.name,
            completed: editor.failure.completed,
            reason: toMessage(editor.failure.error),
          })}
        </FormError>
      )}
      {editor.editing && editor.blankIds.length > 0 && (
        <FormError data-testid="org-chart-blank-name">
          {t('organization.chart.blankName')}
        </FormError>
      )}

      <TreeEditor<OrgChartNodeData>
        value={editor.value}
        onChange={editor.editing ? editor.setDraft : undefined}
        mode="tree"
        direction="TB"
        layout="auto"
        readOnly={!editor.editing}
        nodeSize={NODE_SIZE}
        height="36rem"
        highlightedNodeIds={highlighted}
        getNodeLabel={(node) => node.data.name || t('organization.chart.untitled')}
        createNode={
          editor.editing && canCreate
            ? () => createOrgChartNode(t('organization.chart.newUnit'))
            : undefined
        }
        // 換上層要 orgUnit:update；循環、自己連自己由元件擋，層數在這裡擋
        isValidConnection={(edge, value) => canUpdate && isWithinDepth(edge, value)}
        onBeforeDelete={async ({ nodeIds }) => {
          if (!nodeIds.length) return canUpdate; // 只刪連線 = 變成最上層（換上層）
          if (!canDelete && nodeIds.some((id) => !isNewNodeId(id))) {
            toast.error(t('organization.chart.deleteForbidden'));
            return false;
          }
          // 留下的下層會變成最上層（換上層），要 orgUnit:update
          const deleting = new Set(nodeIds);
          const orphansChildren = editor.value.edges.some(
            (edge) => deleting.has(edge.source) && !deleting.has(edge.target),
          );
          if (orphansChildren && !canUpdate) {
            toast.error(t('organization.chart.orphanForbidden'));
            return false;
          }
          return confirm({
            title: t('organization.chart.deleteTitle'),
            description: orphansChildren
              ? t(deleteConfirmKeys.withChildren, { count: nodeIds.length })
              : t(deleteConfirmKeys.plain, { count: nodeIds.length }),
            confirmLabel: t('common.delete'),
            tone: 'danger',
            'data-testid': 'org-chart-delete-confirm',
          });
        }}
        onNodeClick={(node) => {
          if (!editor.editing) onSelect(node.id);
        }}
        onNodeDoubleClick={(node) => {
          if (editor.editing && canRename(node.id)) {
            setRenaming({ id: node.id, name: node.data.name });
          }
        }}
        renderNode={(node) => (
          <div
            className="flex w-full min-w-0 flex-col gap-0.5 text-start"
            data-testid="org-chart-node"
            data-value={node.id}
            data-new={node.data.isNew || undefined}
          >
            <span className="flex min-w-0 items-center gap-1 font-medium">
              <span className="truncate">{node.data.name || t('organization.chart.untitled')}</span>
              {node.data.isNew && <Chip tone="brand">{t('organization.chart.newBadge')}</Chip>}
            </span>
            <span className="truncate text-xs text-[var(--color-fg-muted)]">
              {node.data.managers.length
                ? t('organization.chart.managers', {
                    names: node.data.managers.join(t('organization.chart.nameSeparator')),
                  })
                : t('organization.chart.noManager')}
            </span>
            <span className="text-xs text-[var(--color-fg-muted)]">
              {t('organization.chart.memberCount', { count: node.data.memberCount })}
            </span>
          </div>
        )}
        aria-label={t('organization.chart.label')}
        data-testid="org-chart-canvas"
      />

      {!editor.editing && detail}

      <OrgChartRenameDialog
        target={renaming}
        onClose={() => setRenaming(undefined)}
        onSubmit={(name) => {
          if (renaming) editor.setDraft(renameNode(editor.value, renaming.id, name));
          setRenaming(undefined);
        }}
      />
    </section>
  );
}

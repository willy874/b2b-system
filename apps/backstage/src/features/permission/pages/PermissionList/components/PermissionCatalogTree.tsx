import { Chip } from '@b2b-system/ui/Chip';
import { Icon } from '@b2b-system/ui/Icon';
import { TreeEditor } from '@b2b-system/ui/TreeEditor';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';

import { PERMISSION_NODE_SIZE } from '@/core/permission-graph';
import type { PermissionNodeData } from '@/core/permission-graph';
import type { PermissionCatalog } from '@/shared/api-sdk';

import { usePermissionCatalogTree } from '../../../hooks/usePermissionCatalogTree';

export interface PermissionCatalogTreeProps {
  catalog: PermissionCatalog;
  /** 套用篩選後要畫的部分。 */
  visible: PermissionCatalog;
  held: ReadonlySet<string>;
  selectedKey?: string;
  onSelect: (key: string | undefined) => void;
}

interface KeyListProps {
  label: string;
  keys: readonly string[];
  nameOf: (key: string) => string;
  onSelect: (key: string) => void;
  testId: string;
}

/** 說明面板裡的一組相關權限：每個都能點，跳到那個節點。 */
function KeyList({ label, keys, nameOf, onSelect, testId }: KeyListProps) {
  if (keys.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <p className="m-0 text-xs font-medium text-[var(--color-fg-muted)]">{label}</p>
      <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
        {keys.map((key) => (
          <li key={key}>
            <button
              type="button"
              className={cn(
                'cursor-pointer rounded-[var(--radius-sm)] border border-[var(--color-border)]',
                'bg-[var(--color-fill-subtle)] px-1.5 py-0.5 text-xs text-inherit',
                'hover:border-[var(--color-brand)]',
              )}
              title={key}
              onClick={() => onSelect(key)}
              data-testid="permission-detail-link"
              data-value={key}
            >
              {nameOf(key)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 權限目錄的樹狀圖（唯讀）：每個資源一組，基礎權限在上、包含它的在下，跨資源的依賴是虛線。
 * 點一個權限在右側面板看它的說明、包含與依賴的權限、被哪些權限帶出；滑過強調它的前置路徑。
 */
export function PermissionCatalogTree({
  catalog,
  visible,
  held,
  selectedKey,
  onSelect,
}: PermissionCatalogTreeProps) {
  const { t } = useTranslation();
  const tree = usePermissionCatalogTree({ catalog, visible, held, selectedKey });
  const detail = tree.detail;

  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_17rem]">
      <TreeEditor<PermissionNodeData>
        // 篩選改變畫哪些節點時重新掛上，讓畫布重新「顯示全部」（fitView 只在掛上時執行）
        key={tree.layout.nodes.map((node) => node.id).join(',')}
        value={tree.layout}
        mode="dag"
        direction="TB"
        layout="manual"
        readOnly
        selectable={false}
        showMinimap={false}
        height="36rem"
        nodeSize={PERMISSION_NODE_SIZE}
        groups={tree.layout.groups}
        getNodeLabel={(node) => t(node.data.nameI18nKey)}
        getNodeState={(node) => (held.has(node.id) ? 'active' : 'available')}
        highlightedNodeIds={tree.path.nodeIds}
        activeEdgeIds={tree.heldEdges}
        highlightedEdgeIds={tree.path.edgeIds}
        renderNode={(node) => {
          const isHeld = held.has(node.id);
          const label = t('common.withNote', {
            name: t(node.data.nameI18nKey),
            note: isHeld ? t('permissionCatalog.held') : t('permissionCatalog.notHeld'),
          });
          return (
            <button
              type="button"
              aria-pressed={node.id === tree.selectedKey}
              aria-label={label}
              className={cn(
                'nodrag flex w-full min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0',
                'text-start text-inherit',
                node.id === tree.selectedKey && 'font-semibold',
              )}
              onClick={() => onSelect(node.id === tree.selectedKey ? undefined : node.id)}
              onMouseEnter={() => tree.setFocusKey(node.id)}
              onMouseLeave={() => tree.setFocusKey(undefined)}
              onFocus={() => tree.setFocusKey(node.id)}
              onBlur={() => tree.setFocusKey(undefined)}
              data-testid="permission-node"
              data-value={node.id}
              data-held={isHeld || undefined}
            >
              <Icon name={isHeld ? 'check' : 'minus'} size={14} />
              <span className="truncate">{t(node.data.nameI18nKey)}</span>
            </button>
          );
        }}
        aria-label={t('permissionCatalog.tree.label')}
      />

      <aside
        className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm"
        data-testid="permission-detail"
      >
        {detail ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className="m-0 text-base font-semibold">{t(detail.item.nameI18nKey)}</p>
              <code className="text-xs text-[var(--color-fg-muted)]">{detail.item.key}</code>
              <p className="m-0">
                {detail.held ? (
                  <Chip tone="success">{t('permissionCatalog.held')}</Chip>
                ) : (
                  <Chip tone="neutral">{t('permissionCatalog.notHeld')}</Chip>
                )}
              </p>
              {detail.item.description && (
                <p
                  className="m-0 text-[var(--color-fg-muted)]"
                  data-testid="permission-detail-description"
                >
                  {detail.item.description}
                </p>
              )}
            </div>
            <KeyList
              label={t('permissionCatalog.tree.includes')}
              keys={detail.includes}
              nameOf={tree.nameOf}
              onSelect={onSelect}
              testId="permission-detail-includes"
            />
            <KeyList
              label={t('permissionCatalog.tree.requires')}
              keys={detail.requires}
              nameOf={tree.nameOf}
              onSelect={onSelect}
              testId="permission-detail-requires"
            />
            <KeyList
              label={t('permissionCatalog.tree.dependents')}
              keys={detail.dependents}
              nameOf={tree.nameOf}
              onSelect={onSelect}
              testId="permission-detail-dependents"
            />
            <KeyList
              label={t('permissionCatalog.tree.grants', { count: detail.grants.length })}
              keys={detail.grants}
              nameOf={tree.nameOf}
              onSelect={onSelect}
              testId="permission-detail-grants"
            />
            {detail.includes.length + detail.requires.length + detail.dependents.length === 0 && (
              <p className="m-0 text-[var(--color-fg-muted)]">
                {t('permissionCatalog.tree.standalone')}
              </p>
            )}
          </div>
        ) : (
          <p className="m-0 text-[var(--color-fg-muted)]">{t('permissionCatalog.tree.empty')}</p>
        )}

        <div className="mt-auto flex flex-col gap-1">
          <p className="m-0 text-xs font-medium text-[var(--color-fg-muted)]">
            {t('permissionCatalog.tree.legend')}
          </p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
            <li className="flex items-center gap-1.5">
              <Icon name="check" size={14} />
              {t('permissionCatalog.held')}
            </li>
            <li className="flex items-center gap-1.5">
              <Icon name="minus" size={14} />
              {t('permissionCatalog.notHeld')}
            </li>
          </ul>
          <p className="m-0 text-xs text-[var(--color-fg-muted)]">
            {t('permissionCatalog.tree.hint')}
          </p>
        </div>
      </aside>
    </div>
  );
}

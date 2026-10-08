import { IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Input } from '@b2b-system/ui/Input';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';
import { useMemo, useState } from 'react';

import { orgUnitAncestorIds } from '@/core/components/OrgUnitPicker';
import type { OrgUnit } from '@/shared/api-sdk';

import { toOrgUnitTreeVM } from '../adapter';
import type { OrgUnitTreeNodeVM } from '../adapter';

interface OrgUnitTreePanelProps {
  units: OrgUnit[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  selectedId: string | undefined;
  onSelect: (unitId: string) => void;
}

/**
 * 左側的部門樹：可展開的縮排樹，以關鍵字（名稱或代碼）在本地篩選。
 * 預設展開最上層與選中部門的上層；有關鍵字時全部展開，符合的部門與它們的上層一律看得到。
 */
export function OrgUnitTreePanel({
  units,
  loading,
  error,
  onRetry,
  selectedId,
  onSelect,
}: OrgUnitTreePanelProps) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  // 使用者手動切換過的節點；沒切換過的依「最上層或選中部門的上層」決定
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const tree = useMemo(() => toOrgUnitTreeVM(units ?? [], keyword), [units, keyword]);
  const selectedPath = useMemo(
    () => new Set(orgUnitAncestorIds(units ?? [], selectedId)),
    [units, selectedId],
  );
  const searching = keyword.trim() !== '';

  const isExpanded = (node: OrgUnitTreeNodeVM) =>
    searching || (toggled.get(node.id) ?? (node.depth === 0 || selectedPath.has(node.id)));
  const toggle = (node: OrgUnitTreeNodeVM) =>
    setToggled((previous) => new Map(previous).set(node.id, !isExpanded(node)));

  const renderNodes = (nodes: OrgUnitTreeNodeVM[]) =>
    nodes.map((node) => {
      const expanded = isExpanded(node);
      return (
        <li key={node.id}>
          <div
            className="flex items-center gap-1"
            // 縮排是連續的值，用 style 而不是組 class（docs/coding-standards/06-literal-strings.md §3.2）
            style={{ paddingLeft: `${node.depth * 16}px` }}
          >
            {node.children.length > 0 ? (
              <IconButton
                size="sm"
                aria-label={t(
                  expanded ? 'organization.tree.collapse' : 'organization.tree.expand',
                  { name: node.name },
                )}
                aria-expanded={expanded}
                onClick={() => toggle(node)}
                data-testid="org-unit-tree-toggle"
                data-value={node.id}
              >
                <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
              </IconButton>
            ) : (
              <span className="inline-block w-7" aria-hidden />
            )}
            <button
              type="button"
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-sm',
                'hover:bg-[var(--color-fill-subtle)]',
                node.id === selectedId && 'bg-[var(--color-fill)] font-semibold',
              )}
              aria-current={node.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(node.id)}
              data-testid="org-unit-tree-node"
              data-value={node.id}
            >
              <span className="truncate">{node.name}</span>
              <span className="ml-auto text-xs text-[var(--color-fg-muted)]">
                {node.memberCount}
              </span>
            </button>
          </div>
          {expanded && node.children.length > 0 && (
            <ul className="m-0 list-none p-0">{renderNodes(node.children)}</ul>
          )}
        </li>
      );
    });

  return (
    <aside
      className="flex w-72 shrink-0 flex-col gap-2 overflow-hidden rounded-md border border-[var(--color-border)] p-2"
      data-testid="org-unit-tree"
    >
      <Input
        size="sm"
        type="search"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder={t('organization.tree.searchPlaceholder')}
        aria-label={t('organization.tree.searchPlaceholder')}
        data-testid="org-unit-tree-search"
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <Skeleton height={160} />
        ) : error ? (
          <QueryError error={error} onRetry={onRetry} data-testid="org-unit-tree-error" />
        ) : tree.length ? (
          // 巢狀清單 ＋ 展開鈕的 aria-expanded；不宣告 role="tree"（那需要整套方向鍵操作）
          <ul aria-label={t('organization.tree.label')} className="m-0 list-none p-0">
            {renderNodes(tree)}
          </ul>
        ) : (
          <p className="m-2 text-sm text-[var(--color-fg-muted)]">
            {searching ? t('organization.tree.noMatch') : t('organization.tree.empty')}
          </p>
        )}
      </div>
    </aside>
  );
}

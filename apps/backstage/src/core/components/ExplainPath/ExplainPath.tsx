import { Fragment } from 'react';

import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import { useTranslation } from '@/core/locales';
import type { ExplainNode } from '@/shared/api-sdk';

/** 節點型別 → 圖示。 */
const NODE_ICON: Record<string, IconName> = {
  user: 'user',
  group: 'users',
  role: 'shield',
  tenant: 'key',
  fileFolder: 'folder',
  fileRoot: 'home',
};

/** 讀不到的節點只顯示種類（docs/adr/0024-relationship-based-access-control.md D14）。 */
const HIDDEN_LABEL_KEY: Record<string, string> = {
  user: 'explain.hidden.user',
  group: 'explain.hidden.group',
  role: 'explain.hidden.role',
  fileFolder: 'explain.hidden.fileFolder',
};

/** 資料夾上的關係：等級與動作。 */
const RELATION_LABEL_KEY: Record<string, string> = {
  viewer: 'explain.relation.viewer',
  contributor: 'explain.relation.contributor',
  editor: 'explain.relation.editor',
  manager: 'explain.relation.manager',
  can_read: 'explain.relation.can_read',
  can_create: 'explain.relation.can_create',
  can_update: 'explain.relation.can_update',
  can_delete: 'explain.relation.can_delete',
  can_share: 'explain.relation.can_share',
};

interface ExplainPathProps {
  nodes: readonly ExplainNode[];
  'data-testid'?: string;
}

/**
 * 「為什麼能做」的路徑（ADR-0024 G4b）：從使用者本人出發，經過群組、角色、資料夾繼承，到最後的權限或動作。
 * 讀不到的節點後端已遮蔽，這裡只顯示它的種類。
 */
export function ExplainPath({ nodes, 'data-testid': testId = 'explain-path' }: ExplainPathProps) {
  const { t } = useTranslation();

  const label = (node: ExplainNode): string => {
    if (node.hidden) return t(HIDDEN_LABEL_KEY[node.type] ?? 'explain.hidden.other');
    switch (node.type) {
      case 'user':
        return node.id === '*' ? t('explain.everyone') : (node.name ?? '');
      case 'tenant':
        return node.relation;
      case 'fileRoot':
        return t('explain.root');
      default: {
        const relationKey = RELATION_LABEL_KEY[node.relation];
        const name = node.name ?? '';
        return relationKey ? `${name}（${t(relationKey)}）` : name;
      }
    }
  };

  return (
    <ol
      className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-xs"
      data-testid={testId}
    >
      {nodes.map((node, index) => (
        // 路徑可能經過同一個節點的不同關係（資料夾的等級 → 動作），以位置當 key
        // oxlint-disable-next-line react/no-array-index-key -- 路徑是固定順序、不重排的清單
        <Fragment key={index}>
          {index > 0 && (
            <li aria-hidden className="text-[var(--color-fg-muted)]">
              <Icon name="chevron-right" size={14} />
            </li>
          )}
          <li
            className="inline-flex items-center gap-1 rounded bg-[var(--color-fill-subtle)] px-1.5 py-0.5"
            data-testid="explain-node"
            data-value={node.type}
            data-hidden={node.hidden || undefined}
          >
            <Icon name={NODE_ICON[node.type] ?? 'info'} size={14} />
            {node.type === 'tenant' ? (
              <code className="font-mono">{label(node)}</code>
            ) : (
              <span className={node.hidden ? 'text-[var(--color-fg-muted)] italic' : undefined}>
                {label(node)}
              </span>
            )}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

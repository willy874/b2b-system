import { useNavigate, useRouterState } from '@tanstack/react-router';

import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Menu } from '@/components/Menu';
import { useTranslation } from '@/core/locales';
import { switchWorkspacePath, useCurrentWorkspace, workspaceSlugOf } from '@/core/workspace';

import { useMyWorkspaces } from '../hooks/useMyWorkspaces';

interface WorkspaceSwitcherProps {
  /** 不在工作區頁面時，選了工作區要去哪裡（由組裝層決定，例：檔案管理器）。 */
  targetPathOf: (slug: string) => string;
}

/**
 * App Shell 的工作區切換器（docs/adr/0018-workspace-tenancy.md D17）：換到另一個工作區的同一頁。
 * 目前的工作區以網址為準；清單是自己能進入的工作區。
 */
export function WorkspaceSwitcher({ targetPathOf }: WorkspaceSwitcherProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const current = useCurrentWorkspace();
  const { data } = useMyWorkspaces();
  const items = data?.items ?? [];
  const inWorkspace = Boolean(workspaceSlugOf(pathname));

  return (
    <Menu
      trigger={
        <Button variant="ghost" data-testid="workspace-switcher-trigger">
          <Icon name="grid" size={16} />
          <span className="max-w-40 truncate">{current?.name ?? t('workspaceSwitcher.label')}</span>
          <Icon name="chevron-down" size={14} />
        </Button>
      }
      emptyLabel={t('workspaceSwitcher.empty')}
      items={items.map((workspace) => ({
        key: workspace.id,
        label: workspace.isMember
          ? workspace.name
          : `${workspace.name} ${t('workspaceSwitcher.notMember')}`,
        textValue: workspace.name,
        disabled: workspace.id === current?.id,
        onSelect: () =>
          void navigate({
            to: inWorkspace
              ? switchWorkspacePath(pathname, workspace.slug)
              : targetPathOf(workspace.slug),
          }),
      }))}
    />
  );
}

/**
 * 選單連到工作區頁面時用的 slug：目前所在的工作區，否則最近進入的，否則第一個。
 * 還不屬於任何工作區時是 undefined（工作區的選單項目不顯示）。
 */
export function useDefaultWorkspaceSlug(): string | undefined {
  const current = useCurrentWorkspace();
  const { data } = useMyWorkspaces();
  if (current) return current.slug;
  const items = data?.items.filter((item) => item.isMember) ?? [];
  const recent = items
    .filter((item) => item.lastAccessedAt)
    .toSorted((a, b) => (b.lastAccessedAt ?? '').localeCompare(a.lastAccessedAt ?? ''));
  return (recent[0] ?? items[0])?.slug;
}

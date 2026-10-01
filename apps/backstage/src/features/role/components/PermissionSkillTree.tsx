import { Chip } from '@/components/Chip';
import { Collapsible } from '@/components/Collapsible';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { Skeleton } from '@/components/Skeleton';
import { TreeEditor } from '@/components/TreeEditor';
import { useTranslation } from '@/core/locales';
import { PERMISSION_NODE_SIZE } from '@/core/permission-graph';
import type { PermissionNodeData } from '@/core/permission-graph';
import { cn } from '@/shared/utils';

import { SKILL_NODE_STATE } from '../hooks/permissionSkillTree';
import type { SkillState } from '../hooks/permissionSkillTree';
import { usePermissionSkillTree } from '../hooks/usePermissionSkillTree';
import type { PermissionSkillTreeOptions } from '../hooks/usePermissionSkillTree';

export interface PermissionSkillTreeProps extends PermissionSkillTreeOptions {
  'data-testid'?: string;
}

const STATE_LABEL_KEY = {
  explicit: 'role.permission.skillTree.state.explicit',
  implied: 'role.permission.skillTree.state.implied',
  available: 'role.permission.skillTree.state.available',
  unavailable: 'role.permission.skillTree.state.unavailable',
} as const satisfies Record<SkillState, string>;

const STATE_ICON = {
  explicit: 'check',
  implied: 'lock',
  available: 'plus',
  unavailable: 'minus',
} as const satisfies Record<SkillState, IconName>;

const STATE_ORDER: readonly SkillState[] = ['explicit', 'implied', 'available', 'unavailable'];

/** 切換按鈕的 `aria-pressed`：已包含是「部分」——成立，但不是自己點的、也不能直接取消。 */
const ARIA_PRESSED = {
  explicit: true,
  implied: 'mixed',
  available: false,
  unavailable: false,
} as const satisfies Record<SkillState, boolean | 'mixed'>;

/**
 * 角色權限的挑選（docs/rbac/02-permission-catalog.md §9）：
 * - 樹狀下拉選單：每個資源一組、組內依技能樹由上而下的順序；勾群組等於勾整組可授予的權限。
 *   已包含（由上層帶出）與無法授予的權限停用，互鎖在選單上直接看得到。
 * - 技能樹（預設收合，展開才掛上畫布）：每個資源一組，基礎權限在上、包含它的在下；
 *   點一個權限授予它，它包含的前置自動點亮為「已包含」；要取消前置先取消上層。
 *   結構唯讀（畫布只能平移縮放），互動是節點內的按鈕，鍵盤以 Tab 在權限之間移動、Enter／Space 切換。
 *
 * 兩者共用 `usePermissionSkillTree` 的狀態與互鎖：一邊勾選，另一邊同步；
 * 在下拉選單選的權限，展開技能樹時會強調它的前置路徑並顯示在說明面板。
 */
export function PermissionSkillTree({
  'data-testid': testId,
  ...options
}: PermissionSkillTreeProps) {
  const { t, language } = useTranslation();
  const tree = usePermissionSkillTree(options);

  if (tree.loading) return <Skeleton height={40} />;

  const nameOf = (key: string): string => {
    const item = tree.items.find((permission) => permission.key === key);
    // 語系包還沒載入時 t() 可能沒有結果：退回權限鍵
    return (item && t(item.nameI18nKey)) || key;
  };
  // 語系是 `zh_TW` 這種寫法，Intl 要 BCP 47（`zh-TW`）；還沒初始化時交給瀏覽器預設
  const list = new Intl.ListFormat(language ? language.replace('_', '-') : undefined, {
    type: 'conjunction',
  });
  const names = (keys: readonly string[]) => list.format(keys.map(nameOf));
  const detail = tree.items.find((item) => item.key === tree.detailKey);
  const detailState = detail ? tree.stateOf(detail.key) : undefined;
  const impliedBy = detail ? tree.impliedByOf(detail.key) : [];

  /** 選項下方的說明：為什麼不能勾。 */
  const optionHint = (key: string, state: SkillState): string | undefined => {
    const by = tree.impliedByOf(key);
    if (state === 'implied' && by.length > 0) {
      return t('role.permission.skillTree.impliedBy', { names: names(by) });
    }
    return state === 'unavailable' ? t(STATE_LABEL_KEY.unavailable) : undefined;
  };
  const selectOptions: Array<SelectOption> = tree.optionGroups.map((group) => ({
    value: group.resource,
    label: group.label,
    disabled: tree.readOnly,
    children: group.keys.map((key) => {
      const state = tree.stateOf(key);
      return {
        value: key,
        label: nameOf(key),
        textValue: `${nameOf(key)} ${key}`,
        description: optionHint(key, state),
        disabled: state === 'implied' || state === 'unavailable',
      };
    }),
  }));

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <Select
        multiple
        searchable
        options={selectOptions}
        value={[...tree.lit]}
        onValueChange={tree.select}
        defaultExpandedValues={tree.optionGroups.map((group) => group.resource)}
        valueOrder="options"
        aria-label={t('role.permission.skillTree.select')}
        placeholder={t('role.permission.skillTree.select')}
        searchPlaceholder={t('role.permission.skillTree.search')}
        testIds={{ item: 'role-permission-option' }}
        data-testid="role-permission-select"
      />

      {/* 點了不能變更的權限時念出原因；在技能樹收合時也看得到 */}
      <output
        aria-live="polite"
        className="m-0 block text-sm text-[var(--color-warning-text)] empty:hidden"
        data-testid="role-permission-notice"
      >
        {options.isSuperAdmin
          ? t('role.permission.skillTree.superAdmin')
          : tree.notice?.kind === 'blocked'
            ? t('role.permission.skillTree.blocked', {
                name: nameOf(tree.notice.key),
                names: names(tree.notice.by),
              })
            : tree.notice?.kind === 'unavailable'
              ? t('role.permission.skillTree.unavailable', { name: nameOf(tree.notice.key) })
              : ''}
      </output>

      <Collapsible
        title={t('role.permission.skillTree.viewer')}
        testIds={{ trigger: 'role-permission-tree-toggle' }}
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_15rem]">
          <TreeEditor<PermissionNodeData>
            value={tree.layout}
            mode="dag"
            direction="TB"
            layout="manual"
            readOnly
            selectable={false}
            showMinimap={false}
            height="30rem"
            nodeSize={PERMISSION_NODE_SIZE}
            groups={tree.layout.groups}
            getNodeLabel={(node) => t(node.data.nameI18nKey)}
            getNodeState={(node) => SKILL_NODE_STATE[tree.stateOf(node.id)]}
            highlightedNodeIds={tree.path.nodeIds}
            activeEdgeIds={tree.activeEdges}
            highlightedEdgeIds={tree.path.edgeIds}
            renderNode={(node) => {
              const state = tree.stateOf(node.id);
              return (
                <button
                  type="button"
                  aria-pressed={ARIA_PRESSED[state]}
                  aria-label={`${t(node.data.nameI18nKey)}（${t(STATE_LABEL_KEY[state])}）`}
                  disabled={tree.readOnly || state === 'unavailable'}
                  className={cn(
                    'nodrag flex w-full min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0',
                    'text-start text-inherit disabled:cursor-not-allowed',
                  )}
                  onClick={() => tree.toggle(node.id)}
                  onMouseEnter={() => tree.setFocusKey(node.id)}
                  onMouseLeave={() => tree.setFocusKey(undefined)}
                  onFocus={() => tree.setFocusKey(node.id)}
                  onBlur={() => tree.setFocusKey(undefined)}
                  data-testid="role-permission-node"
                  data-value={node.id}
                  data-state={state}
                >
                  <Icon name={STATE_ICON[state]} size={14} />
                  <span className="truncate">{t(node.data.nameI18nKey)}</span>
                </button>
              );
            }}
            aria-label={t('role.permission.skillTree.label')}
          />

          <aside className="flex flex-col gap-3 text-sm" data-testid="role-permission-detail">
            {detail ? (
              <div className="flex flex-col gap-1">
                <p className="m-0 font-semibold">{t(detail.nameI18nKey)}</p>
                <code className="text-xs text-[var(--color-fg-muted)]">{detail.key}</code>
                {detailState && (
                  <p className="m-0">
                    <Chip tone={detailState === 'explicit' ? 'brand' : 'neutral'}>
                      {t(STATE_LABEL_KEY[detailState])}
                    </Chip>
                  </p>
                )}
                {impliedBy.length > 0 && (
                  <p className="m-0 text-[var(--color-fg-muted)]">
                    {t('role.permission.skillTree.impliedBy', { names: names(impliedBy) })}
                  </p>
                )}
                {detail.includes.length > 0 && (
                  <p className="m-0">
                    {t('role.permission.skillTree.includes')}：{names(detail.includes)}
                  </p>
                )}
                {detail.requires.length > 0 && (
                  <p className="m-0">
                    {t('role.permission.skillTree.requires')}：{names(detail.requires)}
                  </p>
                )}
              </div>
            ) : (
              <p className="m-0 text-[var(--color-fg-muted)]">
                {t('role.permission.skillTree.empty')}
              </p>
            )}

            <div className="mt-auto flex flex-col gap-1">
              <p className="m-0 text-xs font-medium text-[var(--color-fg-muted)]">
                {t('role.permission.skillTree.legend')}
              </p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {STATE_ORDER.map((state) => (
                  <li key={state} className="flex items-center gap-1.5 text-xs">
                    <Icon name={STATE_ICON[state]} size={14} />
                    {t(STATE_LABEL_KEY[state])}
                  </li>
                ))}
              </ul>
              <p className="m-0 text-xs text-[var(--color-fg-muted)]">
                {t('role.permission.skillTree.hint')}
              </p>
            </div>
          </aside>
        </div>
      </Collapsible>
    </div>
  );
}

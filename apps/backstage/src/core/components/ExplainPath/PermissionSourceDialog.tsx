import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Empty } from '@b2b-system/ui/Empty';
import { Icon } from '@b2b-system/ui/Icon';
import type { IconName } from '@b2b-system/ui/Icon';
import { Input } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { Spinner } from '@b2b-system/ui/Spinner';
import { Tabs } from '@b2b-system/ui/Tabs';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';
import { useMemo, useState } from 'react';

import type { PermissionSources } from '@/shared/api-sdk';

import { ExplainPath } from './ExplainPath';
import { PermissionSourceList } from './PermissionSourceList';
import type { PermissionSourceItem } from './permissionSourceModel';
import { filterAndGroup, HIDDEN_ROLE, rolesOf } from './permissionSourceModel';
import { PermissionSourceTree } from './PermissionSourceTree';
import { PermissionSourceViewer } from './PermissionSourceViewer';

interface PermissionSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 誰的有效權限（顯示在標題下方）。 */
  description?: string;
  data: PermissionSources | undefined;
  error: unknown;
  onRetry: () => void;
}

/** 篩選的「所有角色」。 */
const ALL_ROLES = 'all';

const VIEWS = ['list', 'tree'] as const;
type View = (typeof VIEWS)[number];

const VIEW_LABEL_KEY = {
  list: 'explain.view.list',
  tree: 'explain.view.tree',
} as const satisfies Record<View, string>;

/** 與權限目錄頁的切換相同的圖示。 */
const VIEW_ICON = { list: 'list', tree: 'network' } as const satisfies Record<View, IconName>;

/** 樹狀圖需要較寬的畫布，來源面板改成固定寬度。 */
const VIEW_GRID_CLASS = {
  list: 'md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]',
  tree: 'md:grid-cols-[minmax(0,1fr)_20rem]',
} as const satisfies Record<View, string>;

/** 清單自己捲動；樹狀圖是畫布（自己平移縮放），窄畫面時給固定高度。 */
const VIEW_PANE_CLASS = {
  list: 'overflow-y-auto md:pr-1',
  tree: 'h-[24rem] md:h-full',
} as const satisfies Record<View, string>;

function isView(value: string): value is View {
  return (VIEWS as readonly string[]).includes(value);
}

/**
 * 有效權限與來源（docs/architecture/iam/08-explain.md §5）：左邊是清單或樹狀圖（搜尋名稱或鍵、依角色篩選，兩種檢視共用），
 * 右邊是選中權限的每條來源路徑。窄畫面一次只顯示一欄。資料由呼叫端查（打開時才查），core 不碰 `apis/`。
 */
export function PermissionSourceDialog({
  open,
  onOpenChange,
  description,
  data,
  error,
  onRetry,
}: PermissionSourceDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={t('explain.list.title')}
      description={description}
      footer={
        <Button variant="primary" onClick={() => onOpenChange(false)}>
          {t('common.close')}
        </Button>
      }
      data-testid="permission-source-dialog"
    >
      {data ? (
        <PermissionSourceExplorer data={data} />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : (
        <Spinner size={16} />
      )}
    </Dialog>
  );
}

function PermissionSourceExplorer({ data }: { data: PermissionSources }) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  const [role, setRole] = useState(ALL_ROLES);
  const [view, setView] = useState<View>('list');
  const [selectedKey, setSelectedKey] = useState<string>();

  // 語系包還沒載入時 t() 可能沒有結果：退回權限鍵
  const nameOf = (item: PermissionSourceItem) => t(item.nameI18nKey) || item.key;
  const roles = useMemo(() => rolesOf(data.items), [data.items]);
  const groups = filterAndGroup(data.items, {
    needle: keyword.trim().toLowerCase(),
    role: role === ALL_ROLES ? undefined : role,
    nameOf,
  });
  const visibleCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const selected = data.items.find((item) => item.key === selectedKey);

  if (data.items.length === 0) {
    return data.isSuperAdmin ? (
      <SuperAdminNotice data={data} />
    ) : (
      <Empty title={t('explain.noPermissions')} />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {data.isSuperAdmin && <SuperAdminNotice data={data} />}
      <Tabs
        moreLabel={t('common.more')}
        value={view}
        onValueChange={(value) => {
          if (isView(value)) setView(value);
        }}
        tabs={VIEWS.map((option) => ({
          value: option,
          textValue: t(VIEW_LABEL_KEY[option]),
          label: (
            <span className="flex items-center gap-1.5">
              <Icon name={VIEW_ICON[option]} size={14} />
              {t(VIEW_LABEL_KEY[option])}
            </span>
          ),
        }))}
        testIds={{ tab: 'permission-source-view-tab' }}
        data-testid="permission-source-view"
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          size="sm"
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t('explain.list.search')}
          aria-label={t('explain.list.search')}
          className="sm:flex-1"
          data-testid="permission-source-search"
        />
        {roles.length > 1 && (
          <Select
            size="sm"
            value={role}
            onValueChange={setRole}
            aria-label={t('explain.list.role')}
            className="sm:w-56"
            options={[
              { value: ALL_ROLES, label: t('explain.list.allRoles') },
              ...roles.map((option) => ({
                value: option.value,
                label:
                  option.value === HIDDEN_ROLE || !option.name
                    ? t('explain.hidden.role')
                    : option.name,
              })),
            ]}
            data-testid="permission-source-role"
          />
        )}
      </div>
      <p
        className="m-0 text-xs text-[var(--color-fg-muted)]"
        data-testid="permission-source-summary"
      >
        {visibleCount === data.items.length
          ? t('explain.list.summary', { count: data.items.length, roles: roles.length })
          : t('explain.list.filtered', { count: visibleCount, total: data.items.length })}
      </p>
      {/* 扣掉對話框的標題、頁尾、分頁與篩選列（約 24rem），整個對話框本體不必捲動，捲動只發生在清單或畫布裡 */}
      <div
        className={cn(
          'grid gap-4 md:h-[clamp(16rem,calc(100vh-24rem),32rem)]',
          VIEW_GRID_CLASS[view],
        )}
      >
        <div className={cn('min-h-0', VIEW_PANE_CLASS[view], selected && 'hidden md:block')}>
          {groups.length === 0 ? (
            <p className="m-0 px-2 text-sm text-[var(--color-fg-muted)]">
              {t('explain.list.noMatch')}
            </p>
          ) : view === 'tree' ? (
            <PermissionSourceTree
              groups={groups}
              items={data.items}
              selectedKey={selectedKey}
              onSelect={(item) => setSelectedKey(item.key)}
            />
          ) : (
            <PermissionSourceList
              groups={groups}
              selectedKey={selectedKey}
              onSelect={(item) => setSelectedKey(item.key)}
              nameOf={nameOf}
            />
          )}
        </div>
        <div
          className={cn(
            'min-h-0 overflow-y-auto md:border-l md:border-l-solid md:border-[var(--color-border)] md:pl-4',
            !selected && 'hidden md:block',
          )}
        >
          {selected ? (
            <PermissionSourceViewer
              item={selected}
              name={nameOf(selected)}
              onBack={() => setSelectedKey(undefined)}
            />
          ) : (
            <p className="m-0 flex h-full items-center justify-center text-sm text-[var(--color-fg-muted)]">
              {t('explain.viewer.empty')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SuperAdminNotice({ data }: { data: PermissionSources }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col gap-1 rounded-[var(--radius-md)] bg-[var(--color-warning-fill)] p-3"
      data-testid="permission-source-super-admin"
    >
      <p className="m-0 text-sm text-[var(--color-warning-text)]">{t('explain.superAdmin')}</p>
      {data.superAdminVia && <ExplainPath nodes={data.superAdminVia} />}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';

import { getPermissionListQueryOptions } from '@/apis/permission/get-permission-list/query';
import { Empty } from '@/components/Empty';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import { Skeleton } from '@/components/Skeleton';
import { Tabs, TabsPanel } from '@/components/Tabs';
import { useTranslation } from '@/core/locales';
import { usePermission } from '@/core/permission';

import { useFilteredPermissionCatalog } from '../../hooks/useFilteredPermissionCatalog';
import { PERMISSION_VIEWS } from '../../routes';
import type { PermissionView } from '../../routes';
import {
  PermissionCatalogFilter,
  PermissionCatalogList,
  PermissionCatalogTree,
} from './components';
import { usePermissionSearch } from './usePermissionSearch';

const VIEW_LABEL_KEY = {
  list: 'permissionCatalog.view.list',
  tree: 'permissionCatalog.view.tree',
} as const satisfies Record<PermissionView, string>;

const VIEW_ICON = { list: 'list', tree: 'network' } as const satisfies Record<
  PermissionView,
  IconName
>;

export default function PermissionListPage() {
  const { t } = useTranslation();
  const { permissions: mine } = usePermission();
  const { data, isPending } = useQuery(getPermissionListQueryOptions());
  const { search, setView, setFilters, resetFilters, selectKey, showInTree } =
    usePermissionSearch();
  const filters = { keyword: search.keyword, resource: search.resource, held: search.held };
  const visible = useFilteredPermissionCatalog(data, filters, mine);

  return (
    <div className="flex flex-col gap-4" data-testid="permission-list-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('permissionCatalog.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {t('permissionCatalog.description')}
        </p>
      </header>

      <Tabs
        value={search.view}
        onValueChange={(value) => setView(value as PermissionView)}
        tabs={PERMISSION_VIEWS.map((view) => ({
          value: view,
          label: (
            <span className="flex items-center gap-1.5">
              <Icon name={VIEW_ICON[view]} size={14} />
              {t(VIEW_LABEL_KEY[view])}
            </span>
          ),
        }))}
        testIds={{ tab: 'permission-view-tab' }}
        data-testid="permission-view"
      >
        {isPending && <Skeleton height={200} />}
        {data && visible && (
          <div className="flex flex-col gap-4 pt-4">
            <PermissionCatalogFilter
              catalog={data}
              filters={filters}
              matched={visible.items.length}
              onChange={setFilters}
              onReset={resetFilters}
            />
            {visible.items.length === 0 ? (
              <Empty
                title={t('permissionCatalog.filter.empty')}
                data-testid="permission-filter-empty"
              />
            ) : (
              <>
                <TabsPanel value="list">
                  <PermissionCatalogList catalog={visible} held={mine} onShowInTree={showInTree} />
                </TabsPanel>
                <TabsPanel value="tree">
                  <PermissionCatalogTree
                    catalog={data}
                    visible={visible}
                    held={mine}
                    selectedKey={search.key}
                    onSelect={selectKey}
                  />
                </TabsPanel>
              </>
            )}
          </div>
        )}
      </Tabs>
    </div>
  );
}

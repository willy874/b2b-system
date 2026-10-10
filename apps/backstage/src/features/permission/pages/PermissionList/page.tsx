import { Empty } from '@b2b-system/ui/Empty';
import { Icon } from '@b2b-system/ui/Icon';
import type { IconName } from '@b2b-system/ui/Icon';
import { PageHeader } from '@b2b-system/ui/PageHeader';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { Tabs, TabsPanel } from '@b2b-system/ui/Tabs';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getPermissionListQueryOptions } from '@/apis/permission/get-permission-list/query';
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
  const { data, isPending, error, refetch } = useQuery(getPermissionListQueryOptions());
  const { search, setView, setFilters, resetFilters, selectKey, showInTree } =
    usePermissionSearch();
  const filters = { keyword: search.keyword, resource: search.resource, held: search.held };
  const visible = useFilteredPermissionCatalog(data, filters, mine);

  return (
    <div className="flex flex-col gap-4" data-testid="permission-list-page">
      <PageHeader
        title={t('permissionCatalog.title')}
        description={t('permissionCatalog.description')}
      />

      <Tabs
        moreLabel={t('common.more')}
        value={search.view}
        onValueChange={(value) => setView(value as PermissionView)}
        tabs={PERMISSION_VIEWS.map((view) => ({
          value: view,
          textValue: t(VIEW_LABEL_KEY[view]),
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
        {/* 查詢失敗：說明並提供重試，不是分頁下方一片空白 */}
        {error && !data && (
          <QueryError
            className="pt-4"
            error={error}
            onRetry={() => void refetch()}
            data-testid="permission-list-error"
          />
        )}
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

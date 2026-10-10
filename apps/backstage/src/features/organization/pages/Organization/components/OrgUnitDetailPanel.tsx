import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { isNotFound } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { getOrgUnitDetailQueryOptions } from '@/apis/org-unit/get-org-unit-detail/query';
import type { OrgUnitDetail } from '@/shared/api-sdk';

import type { useOrgUnitPermission } from '../../../hooks/useOrgUnitPermission';
import { OrganizationRoute } from '../../../routes';
import { OrgUnitBasicSection } from './OrgUnitBasicSection';
import { OrgUnitMemberSection } from './OrgUnitMemberSection';

interface OrgUnitDetailPanelProps {
  unitId: string;
  permission: ReturnType<typeof useOrgUnitPermission>;
  onCreateChild: (unit: OrgUnitDetail) => void;
  onMove: (unit: OrgUnitDetail) => void;
  onDelete: (unit: OrgUnitDetail) => void;
  /** 深層連結指向已刪除的部門時「回到組織」。 */
  onBack: () => void;
}

/** 右側：選中部門的上層路徑、基本資料、操作與成員。 */
export function OrgUnitDetailPanel({
  unitId,
  permission,
  onCreateChild,
  onMove,
  onDelete,
  onBack,
}: OrgUnitDetailPanelProps) {
  const { t } = useTranslation();
  const { view } = OrganizationRoute.useSearch();
  const unit = useQuery(getOrgUnitDetailQueryOptions(unitId));

  if (unit.isPending) return <Skeleton height={200} />;
  if (unit.isError) {
    return (
      <QueryError
        error={unit.error}
        onRetry={isNotFound(unit.error) ? undefined : () => void unit.refetch()}
        action={
          <Button onClick={onBack} data-testid="org-unit-detail-back">
            {t('organization.detail.back')}
          </Button>
        }
        data-testid="org-unit-detail-error"
      />
    );
  }
  const detail = unit.data;
  // 權限未水合前不渲染操作，避免按鈕突然冒出來（docs/coding-standards/02-frontend.md §3.2）
  const hydrated = permission.hydrated;

  return (
    <div className="flex flex-col gap-5" data-testid="org-unit-detail">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav
            aria-label={t('organization.detail.path')}
            className="flex flex-wrap items-center gap-1 text-xs text-[var(--color-fg-muted)]"
            data-testid="org-unit-path"
          >
            {detail.path.length ? (
              detail.path.map((item) => (
                <span key={item.id} className="flex items-center gap-1">
                  <Link
                    to={OrganizationRoute.to}
                    // 保留目前的檢視（清單或組織圖）：在組織圖沿著路徑往上看時不被帶回清單
                    search={{ unitId: item.id, view }}
                    className="text-[var(--color-brand)]"
                  >
                    {item.name}
                  </Link>
                  <Icon name="chevron-right" size={14} />
                </span>
              ))
            ) : (
              <span>{t('organization.detail.topLevel')}</span>
            )}
          </nav>
          <h2 className="m-0 mt-1 text-lg font-semibold" data-testid="org-unit-name">
            {detail.name}
          </h2>
        </div>
        {hydrated && (
          <div className="flex flex-wrap items-center gap-2">
            {permission.canCreate && (
              <Button
                size="sm"
                startIcon={<Icon name="plus" size={14} />}
                onClick={() => onCreateChild(detail)}
                data-testid="org-unit-create-child-button"
              >
                {t('organization.create.child')}
              </Button>
            )}
            {permission.canUpdate && (
              <Button
                size="sm"
                startIcon={<Icon name="folder-move" size={14} />}
                onClick={() => onMove(detail)}
                data-testid="org-unit-move-button"
              >
                {t('organization.move.open')}
              </Button>
            )}
            {permission.canDelete && (
              <Button
                size="sm"
                variant="danger"
                startIcon={<Icon name="trash" size={14} />}
                onClick={() => onDelete(detail)}
                data-testid="org-unit-delete-button"
              >
                {t('common.delete')}
              </Button>
            )}
          </div>
        )}
      </header>

      <OrgUnitBasicSection unit={detail} canEdit={hydrated && permission.canUpdate} />
      {permission.canViewMembers && (
        <OrgUnitMemberSection unitId={unitId} canEdit={hydrated && permission.canUpdate} />
      )}
    </div>
  );
}

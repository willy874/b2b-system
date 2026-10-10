import { Button, IconButton } from '@b2b-system/ui/Button';
import { Checkbox } from '@b2b-system/ui/Checkbox';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Icon } from '@b2b-system/ui/Icon';
import { Pagination } from '@b2b-system/ui/Pagination';
import { Switch } from '@b2b-system/ui/Switch';
import { QuerySection, useOffsetClamp } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getOrgUnitMembersQueryOptions } from '@/apis/org-unit/get-org-unit-members/query';
import { getUserSearchQueryOptions } from '@/apis/user/get-user-list/query';
import { UserSearchSelect } from '@/core/components/UserSearchSelect';
import type { UpdateOrgUnitMembersRequest } from '@/shared/api-sdk';

import { useOrgUnitMembersUpdateMutation } from '../../../hooks/useOrgUnitMutations';
import { toOrgUnitMemberRowVM } from '../adapter';
import type { OrgUnitMemberRowVM } from '../adapter';
import { OrgUnitMemberTitleDialog } from './OrgUnitMemberTitleDialog';

/** 一位成員的修改（主管、主要部門、職稱）。 */
type OrgUnitMemberChange = UpdateOrgUnitMembersRequest['update'][number];

/** 成員表一頁幾位。 */
const MEMBER_PAGE_SIZE = 50;

interface OrgUnitMemberSectionProps {
  unitId: string;
  /** 有 orgUnit:update：可以加入、移除、切換主管與主要部門、編輯職稱 */
  canEdit: boolean;
}

/**
 * 部門的成員（docs/architecture/backend/23-organization.md §8）。可切換「含下層部門」；
 * 下層部門的成員只顯示、不在這裡改（到他所屬的部門改）。不能改自己（D6），自己的那一列沒有操作。
 */
export function OrgUnitMemberSection({ unitId, canEdit }: OrgUnitMemberSectionProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const [offset, setOffset] = useState(0);
  const [editingTitle, setEditingTitle] = useState<OrgUnitMemberRowVM>();
  const profile = useQuery(getAuthProfileQueryOptions());
  const members = useQuery(
    getOrgUnitMembersQueryOptions({
      unitId,
      offset,
      limit: MEMBER_PAGE_SIZE,
      includeDescendants,
    }),
  );
  const updateMembers = useOrgUnitMembersUpdateMutation();

  const currentUserId = profile.data?.user.id;
  const rows = useMemo(
    () =>
      (members.data?.items ?? []).map((member) =>
        toOrgUnitMemberRowVM(member, { unitId, canUpdate: canEdit, currentUserId }),
      ),
    [members.data, unitId, canEdit, currentUserId],
  );
  const total = members.data?.pagination.total;
  // 移除最後一頁唯一的成員後退回上一頁（docs/architecture/frontend/07-ui-system.md §6.1）
  useOffsetClamp(total, offset, MEMBER_PAGE_SIZE, setOffset);

  const update = (change: OrgUnitMemberChange) =>
    updateMembers.mutateAsync({
      params: { unitId, body: { add: [], update: [change], remove: [] } },
    });

  const remove = (row: OrgUnitMemberRowVM) =>
    void confirm({
      title: t('organization.member.removeTitle'),
      description: t('organization.member.removeConfirm', { name: row.displayName }),
      confirmLabel: t('organization.member.removeAction'),
      tone: 'danger',
      onConfirm: () =>
        updateMembers.mutateAsync({
          params: { unitId, body: { add: [], update: [], remove: [row.userId] } },
        }),
      'data-testid': 'org-unit-member-remove-confirm',
    });

  return (
    <section data-testid="org-unit-member-section">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold">
          {total === undefined
            ? t('organization.detail.membersHeading')
            : t('organization.detail.members', { count: total })}
        </h3>
        <Checkbox
          checked={includeDescendants}
          onCheckedChange={(checked) => {
            setIncludeDescendants(checked);
            setOffset(0);
          }}
          label={t('organization.member.includeDescendants')}
          data-testid="org-unit-member-include-descendants"
        />
      </div>

      <div className="mt-2">
        <QuerySection query={members} data-testid="org-unit-member-error">
          {({ pagination }) => (
            <>
              <ul
                className="flex list-none flex-col divide-y divide-[var(--color-border)] p-0 text-sm"
                data-testid="org-unit-member-list"
              >
                {rows.length ? (
                  rows.map((row) => (
                    <li
                      key={`${row.unitId}:${row.userId}`}
                      className="flex flex-wrap items-center gap-2 py-2"
                      data-testid="org-unit-member"
                      data-value={row.userId}
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-2">
                          <RouteLink
                            to="user.detail"
                            params={{ userId: row.userId }}
                            className="text-[var(--color-brand)]"
                          >
                            {row.displayName}
                          </RouteLink>
                          {row.isManager && (
                            <Chip tone="brand">{t('organization.member.manager')}</Chip>
                          )}
                          {row.isPrimary && (
                            <Chip tone="neutral">{t('organization.member.primary')}</Chip>
                          )}
                        </span>
                        <span className="text-xs text-[var(--color-fg-muted)]">
                          {[row.email, row.title, row.descendantUnitName]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                      {row.canEdit && (
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1 text-xs">
                            <Switch
                              checked={row.isManager}
                              disabled={updateMembers.isPending}
                              onCheckedChange={(checked) =>
                                void update({ userId: row.userId, isManager: checked }).catch(
                                  () => undefined, // 錯誤由 mutation 的 onError 顯示
                                )
                              }
                              aria-label={t('organization.member.toggleManager', {
                                name: row.displayName,
                              })}
                              data-testid="org-unit-member-manager"
                              data-value={row.userId}
                            />
                            {t('organization.member.manager')}
                          </label>
                          <label className="flex items-center gap-1 text-xs">
                            <Switch
                              checked={row.isPrimary}
                              disabled={updateMembers.isPending}
                              onCheckedChange={(checked) =>
                                void update({ userId: row.userId, isPrimary: checked }).catch(
                                  () => undefined, // 錯誤由 mutation 的 onError 顯示
                                )
                              }
                              aria-label={t('organization.member.togglePrimary', {
                                name: row.displayName,
                              })}
                              data-testid="org-unit-member-primary"
                              data-value={row.userId}
                            />
                            {t('organization.member.primary')}
                          </label>
                          <IconButton
                            size="sm"
                            aria-label={t('organization.member.editTitle', {
                              name: row.displayName,
                            })}
                            onClick={() => setEditingTitle(row)}
                            data-testid="org-unit-member-title"
                            data-value={row.userId}
                          >
                            <Icon name="edit" size={14} />
                          </IconButton>
                          <IconButton
                            size="sm"
                            aria-label={t('organization.member.remove', { name: row.displayName })}
                            disabled={updateMembers.isPending}
                            onClick={() => remove(row)}
                            data-testid="org-unit-member-remove"
                            data-value={row.userId}
                          >
                            <Icon name="close" size={14} />
                          </IconButton>
                        </div>
                      )}
                    </li>
                  ))
                ) : (
                  <li className="py-2 text-[var(--color-fg-muted)]">{t('common.none')}</li>
                )}
              </ul>
              {pagination.total > MEMBER_PAGE_SIZE && (
                <Pagination
                  className="mt-2"
                  offset={offset}
                  limit={MEMBER_PAGE_SIZE}
                  pageSizeOptions={[MEMBER_PAGE_SIZE]}
                  total={pagination.total}
                  onChange={(next) => setOffset(next.offset)}
                  data-testid="org-unit-member-pagination"
                />
              )}
            </>
          )}
        </QuerySection>
      </div>
      {canEdit && <AddMemberRow unitId={unitId} />}

      <OrgUnitMemberTitleDialog
        member={editingTitle}
        pending={updateMembers.isPending}
        onSubmit={(member, title) => update({ userId: member.userId, title })}
        onClose={() => setEditingTitle(undefined)}
      />
    </section>
  );
}

/** 加入一位成員：使用者在伺服器端搜尋（`UserSearchSelect`）；主管、主要部門加入後再切換。 */
function AddMemberRow({ unitId }: { unitId: string }) {
  const { t } = useTranslation();
  const [userId, setUserId] = useState<string | null>(null);
  const updateMembers = useOrgUnitMembersUpdateMutation();

  const submit = () => {
    if (!userId) return;
    updateMembers.mutate(
      { params: { unitId, body: { add: [{ userId }], update: [], remove: [] } } },
      { onSuccess: () => setUserId(null) },
    );
  };

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <UserSearchSelect
        query={getUserSearchQueryOptions}
        className="min-w-48 flex-1"
        aria-label={t('organization.member.target')}
        placeholder={t('organization.member.placeholder')}
        value={userId}
        onValueChange={setUserId}
        noMatchLabel={t('organization.member.noMatch')}
        data-testid="org-unit-member-target"
      />
      <Button
        variant="primary"
        disabled={!userId}
        loading={updateMembers.isPending}
        onClick={submit}
        data-testid="org-unit-member-add"
      >
        {t('organization.member.add')}
      </Button>
    </div>
  );
}

import { Chip } from '@b2b-system/ui/Chip';
import { Select } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getGroupOptionsQueryOptions } from '@/apis/group/get-group-list/query';
import { getOrgUnitTreeQueryOptions } from '@/apis/org-unit/get-org-unit-tree/query';
import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';
import type { ApprovalAssigneeStatus, OrgUnit } from '@/shared/api-sdk';

import { UserSearchSelect } from '../../../components/UserSearchSelect';
import { APPROVAL_MANAGER_MAX_LEVEL, ASSIGNEE_KIND_LABEL_KEY } from '../../../constants';
import type { AssigneeKind } from '../../../constants';
import { changeAssigneeKind } from '../../../hooks/flowDraft';
import type { AssigneeDraft } from '../../../hooks/flowDraft';
import type { AssigneeKindAvailability } from '../../../hooks/useAssigneeKindAvailability';

/** 規則選擇器能讀哪些清單（`useApprovalFlowPermission` 的子集）。 */
export interface AssigneeListAccess {
  canSearchUsers: boolean;
  canListGroups: boolean;
  canListRoles: boolean;
  canListOrgUnits: boolean;
}

interface AssigneeRuleEditorProps {
  value: AssigneeDraft;
  onChange: (value: AssigneeDraft) => void;
  /** 匿名申請的類型（註冊）沒有申請人可以往上找，不提供「主管」（docs/architecture/backend/20-approval.md §9.1）。 */
  isAnonymous: boolean;
  availability: AssigneeKindAvailability;
  access: AssigneeListAccess;
  /** 伺服器上這條規則的狀態；規則在這次編輯中改過就沒有。 */
  savedStatus?: ApprovalAssigneeStatus;
  invalid: boolean;
}

const KINDS = ['user', 'group', 'role', 'manager', 'orgUnit'] as const satisfies AssigneeKind[];

const MANAGER_LEVELS = Array.from({ length: APPROVAL_MANAGER_MAX_LEVEL }, (_, index) => index + 1);

/** 「上層 / 部門」：部門樹是扁平陣列，沿著 `parentId` 組出完整路徑。 */
function orgUnitPath(unit: OrgUnit, byId: ReadonlyMap<string, OrgUnit>): string {
  const names = [unit.name];
  const seen = new Set([unit.id]);
  let parentId = unit.parentId;
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    seen.add(parent.id);
    parentId = parent.parentId;
  }
  return names.join(' / ');
}

/** 審核者規則：種類 → 對象（使用者搜尋／群組／角色／主管層級／部門）。不能用的種類停用並說明原因（D14）。 */
export function AssigneeRuleEditor({
  value,
  onChange,
  isAnonymous,
  availability,
  access,
  savedStatus,
  invalid,
}: AssigneeRuleEditorProps) {
  const { t } = useTranslation();
  const kinds = KINDS.filter((kind) => kind !== 'manager' || !isAnonymous || value.kind === kind);
  const kindOptions = kinds.map((kind) => {
    const reason = availability[kind];
    return {
      value: kind,
      label: t(ASSIGNEE_KIND_LABEL_KEY[kind]),
      // 已經選了的種類保留可選（只是標出警示），其他不能用的停用
      disabled: Boolean(reason) && kind !== value.kind,
      description: reason ? t(reason) : undefined,
    };
  });
  const unavailableReason = availability[value.kind];
  const savedLabel = savedStatus?.label;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-44"
          aria-label={t('approvalFlow.assignee.kindLabel')}
          options={kindOptions}
          value={value.kind}
          onValueChange={(kind) => onChange(changeAssigneeKind(value, kind))}
          itemSize={48}
          data-testid="approval-flow-assignee-kind"
        />
        <div className="min-w-48 flex-1">
          {value.kind === 'user' && (
            <UserSearchSelect
              aria-label={t('approvalFlow.assignee.target')}
              value={value.targetId}
              selectedLabel={savedLabel}
              onChange={(targetId) => onChange({ ...value, targetId })}
              disabled={!access.canSearchUsers}
              invalid={invalid}
              data-testid="approval-flow-assignee-user"
            />
          )}
          {value.kind === 'group' && (
            <GroupTarget
              value={value}
              onChange={onChange}
              enabled={access.canListGroups && !unavailableReason}
              savedLabel={savedLabel}
              invalid={invalid}
            />
          )}
          {value.kind === 'role' && (
            <RoleTarget
              value={value}
              onChange={onChange}
              enabled={access.canListRoles}
              savedLabel={savedLabel}
              invalid={invalid}
            />
          )}
          {value.kind === 'orgUnit' && (
            <OrgUnitTarget
              value={value}
              onChange={onChange}
              enabled={access.canListOrgUnits && !unavailableReason}
              savedLabel={savedLabel}
              invalid={invalid}
            />
          )}
          {value.kind === 'manager' && (
            <Select
              aria-label={t('approvalFlow.assignee.level')}
              options={MANAGER_LEVELS.map((level) => ({
                value: String(level),
                label: t('approvalFlow.assignee.managerLevel', { level }),
              }))}
              value={String(value.level)}
              onValueChange={(level) => onChange({ ...value, level: Number(level) })}
              data-testid="approval-flow-assignee-level"
            />
          )}
        </div>
      </div>
      <AssigneeWarnings unavailableReason={unavailableReason} savedStatus={savedStatus} />
    </div>
  );
}

interface TargetProps {
  value: AssigneeDraft;
  onChange: (value: AssigneeDraft) => void;
  /** 讀得到清單（權限、feature）才載入；讀不到時只顯示目前的值。 */
  enabled: boolean;
  savedLabel?: string;
  invalid: boolean;
}

/** 選項裡沒有目前的值（讀不到清單、或對象已刪除）時，以已儲存的顯示名稱補上一列。 */
function withCurrent(
  options: Array<{ value: string; label: string }>,
  targetId: string | null,
  savedLabel?: string,
) {
  if (targetId && !options.some((option) => option.value === targetId)) {
    return [{ value: targetId, label: savedLabel || targetId }, ...options];
  }
  return options;
}

function GroupTarget({ value, onChange, enabled, savedLabel, invalid }: TargetProps) {
  const { t } = useTranslation();
  const groups = useQuery({ ...getGroupOptionsQueryOptions(), enabled });
  const options = (groups.data?.items ?? []).map((group) => ({
    value: group.id,
    label: group.name,
  }));
  return (
    <Select
      aria-label={t('approvalFlow.assignee.target')}
      placeholder={t('approvalFlow.assignee.groupPlaceholder')}
      options={withCurrent(options, value.targetId, savedLabel)}
      value={value.targetId}
      onValueChange={(targetId) => onChange({ ...value, targetId })}
      searchable
      loading={groups.isFetching}
      disabled={!enabled}
      invalid={invalid}
      data-testid="approval-flow-assignee-group"
    />
  );
}

function RoleTarget({ value, onChange, enabled, savedLabel, invalid }: TargetProps) {
  const { t } = useTranslation();
  const roles = useQuery({ ...getRoleOptionsQueryOptions(), enabled });
  const options = (roles.data?.items ?? []).map((role) => ({ value: role.id, label: role.name }));
  return (
    <Select
      aria-label={t('approvalFlow.assignee.target')}
      placeholder={t('approvalFlow.assignee.rolePlaceholder')}
      options={withCurrent(options, value.targetId, savedLabel)}
      value={value.targetId}
      onValueChange={(targetId) => onChange({ ...value, targetId })}
      searchable
      loading={roles.isFetching}
      disabled={!enabled}
      invalid={invalid}
      data-testid="approval-flow-assignee-role"
    />
  );
}

function OrgUnitTarget({ value, onChange, enabled, savedLabel, invalid }: TargetProps) {
  const { t } = useTranslation();
  const tree = useQuery({ ...getOrgUnitTreeQueryOptions(), enabled });
  const units = tree.data?.items ?? [];
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const options = units
    .map((unit) => ({ value: unit.id, label: orgUnitPath(unit, byId) }))
    .toSorted((left, right) => left.label.localeCompare(right.label));
  return (
    <Select
      aria-label={t('approvalFlow.assignee.target')}
      placeholder={t('approvalFlow.assignee.orgUnitPlaceholder')}
      options={withCurrent(options, value.targetId, savedLabel)}
      value={value.targetId}
      onValueChange={(targetId) => onChange({ ...value, targetId })}
      searchable
      loading={tree.isFetching}
      disabled={!enabled}
      invalid={invalid}
      data-testid="approval-flow-assignee-org-unit"
    />
  );
}

interface AssigneeWarningsProps {
  unavailableReason: string | undefined;
  savedStatus?: ApprovalAssigneeStatus;
}

/**
 * 規則不能用（組織管理、群組未啟用）或指到已刪除的對象：關卡啟動時會找不到人、需要 override 處理
 * （docs/architecture/backend/20-approval.md §9.12）。
 */
function AssigneeWarnings({ unavailableReason, savedStatus }: AssigneeWarningsProps) {
  const { t } = useTranslation();
  const reason =
    unavailableReason ??
    (savedStatus && !savedStatus.available
      ? 'approvalFlow.assignee.unavailable.feature'
      : undefined);
  if (!reason && !savedStatus?.deleted) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {reason && (
        <Chip tone="warning" data-testid="approval-flow-assignee-unavailable">
          {t(reason)}
        </Chip>
      )}
      {savedStatus?.deleted && (
        <Chip tone="danger" data-testid="approval-flow-assignee-deleted">
          {t('approvalFlow.assignee.deleted')}
        </Chip>
      )}
    </div>
  );
}

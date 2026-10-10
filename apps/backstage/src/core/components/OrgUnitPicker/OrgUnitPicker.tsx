import { Select } from '@b2b-system/ui/Select';
import type { SelectOption } from '@b2b-system/ui/Select';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { buildOrgUnitTree, orgUnitAncestorIds } from './orgUnitTree';
import type { OrgUnitTreeNode, OrgUnitTreeSource } from './orgUnitTree';

/** 「不指定部門」選項的值（`Select` 的值是字串；對外仍以 `null` 表示）。 */
const NONE_VALUE = '';

export interface OrgUnitPickerProps {
  /** 整棵部門樹（扁平陣列，例：`GET /org-units` 的 `items`）；由呼叫端查詢，`core` 不打 API。 */
  units: readonly OrgUnitTreeSource[] | undefined;
  /** 選中的部門；`null` = 沒有選。 */
  value: string | null;
  onChange: (unitId: string | null) => void;
  /** 有傳就在最上方多一個代表「不指定」的選項（例：篩選的「全部部門」、搬移的「最上層」）。 */
  noneLabel?: string;
  /** 不能選的部門（例：搬移時的自己與下層）。 */
  disabledIds?: ReadonlySet<string>;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  noMatchLabel?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

function toOptions(
  nodes: ReadonlyArray<OrgUnitTreeNode>,
  disabledIds: ReadonlySet<string> | undefined,
): Array<SelectOption> {
  return nodes.map(({ unit, children }) => ({
    value: unit.id,
    label: unit.name,
    // 搜尋同時比對名稱與代碼（`Select` 的本地過濾看 `textValue`）
    textValue: unit.code ? `${unit.name} ${unit.code}` : unit.name,
    description: unit.code ?? undefined,
    disabled: disabledIds?.has(unit.id),
    children: children.length > 0 ? toOptions(children, disabledIds) : undefined,
  }));
}

/**
 * 樹狀、可搜尋的部門選擇器（docs/architecture/backend/23-organization.md §8）：使用者列表的部門篩選、
 * 組織頁的「搬移到…」共用。有下層的部門本身也能選（`selectableGroups`），
 * 搜尋時只留下符合的部門與它們的上層。文字全部由呼叫端傳入（`core` 不依賴 feature 的語系包）。
 */
export function OrgUnitPicker({
  units,
  value,
  onChange,
  noneLabel,
  disabledIds,
  loading,
  disabled,
  placeholder,
  searchPlaceholder,
  noMatchLabel,
  size,
  className,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: OrgUnitPickerProps) {
  const options = useMemo(() => {
    const tree = toOptions(buildOrgUnitTree(units ?? []), disabledIds);
    return noneLabel === undefined ? tree : [{ value: NONE_VALUE, label: noneLabel }, ...tree];
  }, [units, disabledIds, noneLabel]);
  // 開啟時選中的部門看得到：它的上層都展開
  const expanded = useMemo(() => orgUnitAncestorIds(units ?? [], value), [units, value]);

  return (
    <Select
      options={options}
      selectableGroups
      searchable
      value={value ?? (noneLabel === undefined ? null : NONE_VALUE)}
      onValueChange={(next) => onChange(next === NONE_VALUE ? null : next)}
      defaultExpandedValues={expanded}
      loading={loading}
      disabled={disabled}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      noMatchLabel={noMatchLabel}
      size={size}
      className={className}
      aria-label={ariaLabel}
      itemSize={48}
      data-testid={testId}
    />
  );
}

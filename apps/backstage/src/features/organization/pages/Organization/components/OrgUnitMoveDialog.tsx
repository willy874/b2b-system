import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useMemo, useState } from 'react';

import { OrgUnitPicker, orgUnitSubtreeIds } from '@/core/components/OrgUnitPicker';
import type { OrgUnit, OrgUnitDetail } from '@/shared/api-sdk';

import { useOrgUnitMoveMutation } from '../../../hooks/useOrgUnitMutations';

interface OrgUnitMoveDialogProps {
  /** 要搬移的部門；`undefined` 時關閉。 */
  unit: OrgUnitDetail | undefined;
  units: readonly OrgUnit[] | undefined;
  onClose: () => void;
}

/**
 * 搬移到…：選新的上層（或最上層），排在新上層的最後。自己與下層不能選（後端另外擋循環 `ORG_UNIT_CYCLE`
 * 與層數上限 `ORG_UNIT_TOO_DEEP`）。拖放排序不做，見 docs/architecture/backend/23-organization.md §8。
 */
export function OrgUnitMoveDialog({ unit, units, onClose }: OrgUnitMoveDialogProps) {
  const { t } = useTranslation();
  const moveUnit = useOrgUnitMoveMutation();
  const [parentId, setParentId] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState<OrgUnitDetail>();
  // 每次開啟從目前的上層開始（render 期間調整 state，不經過 effect）
  if (unit !== openedFor) {
    setOpenedFor(unit);
    setParentId(unit?.parentId ?? null);
  }
  const disabledIds = useMemo(
    () => (unit ? orgUnitSubtreeIds(units ?? [], unit.id) : undefined),
    [unit, units],
  );
  const changed = unit !== undefined && parentId !== unit.parentId;

  const submit = () => {
    if (!unit || !changed) return;
    moveUnit.mutate(
      { params: { unitId: unit.id, body: { parentId, version: unit.version } } },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      open={Boolean(unit)}
      onOpenChange={(open) => !open && onClose()}
      title={t('organization.move.title', { name: unit?.name ?? '' })}
      size="sm"
      data-testid="org-unit-move-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!changed}
            loading={moveUnit.isPending}
            onClick={submit}
            data-testid="org-unit-move-submit"
          >
            {t('organization.move.action')}
          </Button>
        </>
      }
    >
      <OrgUnitPicker
        units={units}
        value={parentId}
        onChange={setParentId}
        noneLabel={t('organization.move.topLevel')}
        disabledIds={disabledIds}
        aria-label={t('organization.move.target')}
        searchPlaceholder={t('organization.tree.searchPlaceholder')}
        noMatchLabel={t('organization.tree.noMatch')}
        data-testid="org-unit-move-target"
      />
    </Dialog>
  );
}

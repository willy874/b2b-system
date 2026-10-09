import { Button } from '@b2b-system/ui/Button';
import type { ButtonSize } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { useTranslation } from '@b2b-system/web-core/locales';
import { Suspense, useMemo, useState } from 'react';

import { partitionFileActionTargets, useFileActions } from '@/core/file';
import type {
  FileActionDefinition,
  FileActionPlacement,
  FileActionSkipped,
  FileActionTarget,
} from '@/core/file';

import { FILE_IMAGE_SOURCE_ID } from '../../../constants';

/** 每個位置的按鈕 testid（docs/coding-standards/06-literal-strings.md §3.3：動作的 id 放 `data-value`）。 */
const ACTION_TEST_ID = {
  selectionBar: 'file-selection-action',
  lightbox: 'file-lightbox-action',
} as const satisfies Record<FileActionPlacement, string>;

const BUTTON_SIZE = {
  selectionBar: 'sm',
  lightbox: 'md',
} as const satisfies Record<FileActionPlacement, ButtonSize>;

interface FileActionButtonsProps {
  placement: FileActionPlacement;
  /** 動作的對象：只有檔案（資料夾不算）；空陣列時不渲染。 */
  files: readonly FileActionTarget[];
}

interface PendingAction {
  action: FileActionDefinition;
  files: readonly FileActionTarget[];
  skipped: readonly FileActionSkipped[];
}

/** 只交出 `FileActionTarget` 的欄位：動作不該依賴檔案管理器的 VM。 */
function toTarget({ id, name, contentType, size }: FileActionTarget): FileActionTarget {
  return { id, name, contentType, size };
}

/**
 * 其他 feature 以 `registerFileAction` 登記的動作（docs/architecture/frontend/12-file-manager.md §6.2）：
 * 依 `check` 分出可以處理與略過的檔案，全部不能處理時停用並以第一個原因當提示；按下後渲染動作的元件。
 * 沒有任何登記的動作時不渲染東西。
 */
export function FileActionButtons({ placement, files }: FileActionButtonsProps) {
  const { t } = useTranslation();
  const actions = useFileActions(placement);
  const [pending, setPending] = useState<PendingAction>();
  const targets = useMemo(() => files.map(toTarget), [files]);
  const partitions = useMemo(
    () => actions.map((action) => ({ action, ...partitionFileActionTargets(action, targets) })),
    [actions, targets],
  );

  if (targets.length === 0 && !pending) return null;
  const Component = pending?.action.component;

  return (
    <>
      {targets.length > 0 &&
        partitions.map(({ action, files: accepted, skipped }) => {
          const reason = accepted.length === 0 ? skipped[0] : undefined;
          return (
            <Tooltip
              key={action.id}
              content={reason ? t(reason.reasonKey, reason.params) : null}
              disabled={!reason}
            >
              <Button
                size={BUTTON_SIZE[placement]}
                variant="secondary"
                startIcon={<Icon name={action.icon} size={14} />}
                disabled={Boolean(reason)}
                // 停用時仍可聚焦、收得到 hover：提示才出得來（說明為什麼不能按）
                focusableWhenDisabled
                onClick={() => setPending({ action, files: accepted, skipped })}
                data-testid={ACTION_TEST_ID[placement]}
                data-value={action.id}
              >
                {t(action.labelKey)}
              </Button>
            </Tooltip>
          );
        })}
      {pending && Component && (
        <Suspense fallback={null}>
          <Component
            files={pending.files}
            skipped={pending.skipped}
            sourceId={FILE_IMAGE_SOURCE_ID}
            onClose={() => setPending(undefined)}
          />
        </Suspense>
      )}
    </>
  );
}

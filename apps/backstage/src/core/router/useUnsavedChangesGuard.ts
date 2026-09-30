import { useBlocker } from '@tanstack/react-router';
import { useLayoutEffect, useRef } from 'react';

import { useConfirm } from '@/components/ConfirmDialog';
import { useTranslation } from '@/core/locales';

/**
 * 有未儲存的變更時，攔下任何離開目前路由的導覽（關閉路由對話框、點遮罩、Esc、瀏覽器上一頁、點選單），
 * 先問「要放棄變更嗎？」；重新整理或關分頁則交給瀏覽器原生的 `beforeunload` 提示。
 *
 * 表單類對話框都是路由（「對話框即路由」），所以關閉＝導覽，一個 blocker 就涵蓋所有關閉途徑。
 * 儲存成功後要離開時，導覽帶 `ignoreBlocker: true`，不必等 dirty 狀態更新。
 * （docs/issues/04-user-experience.md UX-17、03-edge-cases.md EDGE-26）
 */
export function useUnsavedChangesGuard(isDirty: boolean): void {
  const { t } = useTranslation();
  const confirm = useConfirm();
  // blocker 在導覽當下才讀，用 ref 拿到最新值，避免 shouldBlockFn 閉包到舊的 dirty
  const dirtyRef = useRef(isDirty);
  useLayoutEffect(() => {
    dirtyRef.current = isDirty;
  }, [isDirty]);

  useBlocker({
    shouldBlockFn: async () => {
      if (!dirtyRef.current) return false;
      const discard = await confirm({
        title: t('common.unsaved.title'),
        description: t('common.unsaved.description'),
        confirmLabel: t('common.unsaved.discard'),
        cancelLabel: t('common.unsaved.keepEditing'),
        tone: 'danger',
        'data-testid': 'unsaved-changes-confirm',
      });
      return !discard;
    },
    enableBeforeUnload: () => dirtyRef.current,
  });
}

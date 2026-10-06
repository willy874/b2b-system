import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { useBlocker } from '@tanstack/react-router';
import { useCallback, useLayoutEffect, useRef } from 'react';

import { useTranslation } from '../locales';

/** 確認框的文案；不傳的欄位沿用 `common.unsaved.*`。 */
export interface UnsavedChangesGuardOptions {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * 「要放棄尚未儲存的變更嗎？」確認框：放棄回傳 `true`，繼續編輯（取消、Esc）回傳 `false`。
 * 路由的 guard 與 state 對話框的 guard 共用同一份文案與 `data-testid="unsaved-changes-confirm"`。
 */
export function useConfirmDiscard(): (options?: UnsavedChangesGuardOptions) => Promise<boolean> {
  const { t } = useTranslation();
  const confirm = useConfirm();
  return useCallback(
    (options: UnsavedChangesGuardOptions = {}) =>
      confirm({
        title: options.title ?? t('common.unsaved.title'),
        description: options.description ?? t('common.unsaved.description'),
        confirmLabel: options.confirmLabel ?? t('common.unsaved.discard'),
        cancelLabel: options.cancelLabel ?? t('common.unsaved.keepEditing'),
        tone: 'danger',
        'data-testid': 'unsaved-changes-confirm',
      }),
    [confirm, t],
  );
}

/**
 * 有未儲存的變更時，攔下任何離開目前路由的導覽（關閉路由對話框、點遮罩、Esc、瀏覽器上一頁、點選單），
 * 先問「要放棄變更嗎？」；重新整理或關分頁則交給瀏覽器原生的 `beforeunload` 提示。
 *
 * 表單類對話框都是路由（「對話框即路由」），所以關閉＝導覽，一個 blocker 就涵蓋所有關閉途徑。
 * 取消鈕、Esc、點遮罩的關閉 **不帶** `ignoreBlocker`，才會被攔下；只有儲存成功後要離開時，
 * 導覽才帶 `ignoreBlocker: true`，不必等 dirty 狀態更新（docs/architecture/frontend/04-routing.md §2.1）。
 * 不是路由的對話框（以 state 開關）用 `useDialogUnsavedGuard`。
 */
export function useUnsavedChangesGuard(
  isDirty: boolean,
  options: UnsavedChangesGuardOptions = {},
): void {
  const confirmDiscard = useConfirmDiscard();
  // blocker 在導覽當下才讀，用 ref 拿到最新值，避免 shouldBlockFn 閉包到舊的 dirty
  const dirtyRef = useRef(isDirty);
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    dirtyRef.current = isDirty;
    optionsRef.current = options;
  });

  useBlocker({
    shouldBlockFn: async () => {
      if (!dirtyRef.current) return false;
      return !(await confirmDiscard(optionsRef.current));
    },
    enableBeforeUnload: () => dirtyRef.current,
  });
}

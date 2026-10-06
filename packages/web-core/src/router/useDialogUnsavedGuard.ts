import { useUnsavedChangesGuard, useConfirmDiscard } from './useUnsavedChangesGuard';
import type { UnsavedChangesGuardOptions } from './useUnsavedChangesGuard';

export interface DialogUnsavedGuard {
  /** 給 `Dialog` 的 `onOpenChange`：Esc、點遮罩要關閉時，有未儲存的變更就先確認。 */
  onOpenChange: (open: boolean) => void;
  /** 給取消鈕：有未儲存的變更就先確認，放棄才呼叫 `onClose`。 */
  requestClose: () => void;
}

/**
 * 以 state 開關（不是路由）的表單對話框的未儲存提醒（docs/architecture/frontend/04-routing.md §2.1）。
 *
 * - 關閉對話框（Esc、點遮罩、取消鈕）不是導覽，路由的 blocker 攔不到：改由回傳的 `onOpenChange`／`requestClose`
 *   在 dirty 時先問「要放棄變更嗎？」，選放棄才呼叫 `onClose`。
 * - 對話框開著時換頁（側邊選單、上一頁）與重新整理，交給內部的 `useUnsavedChangesGuard(isDirty)`。
 *
 * `isDirty` 在對話框關著時要是 false（呼叫端以 `open && …` 計算），否則關著的對話框也會攔換頁。
 * 儲存成功後直接呼叫 `onClose`，不經過這裡。
 *
 * ```tsx
 * const guard = useDialogUnsavedGuard(open && name !== initialName, onClose);
 * <Dialog open={open} onOpenChange={guard.onOpenChange} footer={<Button onClick={guard.requestClose}>取消</Button>} />
 * ```
 */
export function useDialogUnsavedGuard(
  isDirty: boolean,
  onClose: () => void,
  options?: UnsavedChangesGuardOptions,
): DialogUnsavedGuard {
  const confirmDiscard = useConfirmDiscard();
  useUnsavedChangesGuard(isDirty, options);

  const requestClose = () => {
    if (!isDirty) {
      onClose();
      return;
    }
    void confirmDiscard(options).then((discard) => {
      if (discard) onClose();
    });
  };

  return {
    onOpenChange: (open) => {
      if (!open) requestClose();
    },
    requestClose,
  };
}

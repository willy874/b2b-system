import { createContext, use, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { AlertDialog } from '../AlertDialog';
import type { AlertDialogSlot } from '../AlertDialog';
import type { SlotOverrides } from '../slots';

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  /** 省略時用 `ConfirmDialogProvider` 的 `confirmLabel`。 */
  confirmLabel?: string;
  /** 省略時用 `ConfirmDialogProvider` 的 `cancelLabel`。 */
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  /**
   * 按下確認後要執行的動作；執行期間按鈕呈 loading、對話框關不掉。
   * 成功才關閉並回傳 `true`；丟錯時對話框留著讓使用者重試或取消，錯誤提示交給呼叫端或全域處理。
   */
  onConfirm?: () => void | Promise<unknown>;
  /** 落在彈窗（popup）。 */
  className?: string;
  'data-testid'?: string;
}

/** 開啟確認對話框；使用者確認回傳 `true`，取消（按鈕、Esc）回傳 `false`。 */
export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** 內層（backdrop、按鈕…）的覆寫套用到每一次 `confirm()`。 */
export interface ConfirmDialogProviderProps extends SlotOverrides<AlertDialogSlot> {
  /** 預設確認按鈕文案；`components/` 不依賴語系，由掛載端以 `t()` 傳入。 */
  confirmLabel: string;
  cancelLabel: string;
  children: ReactNode;
}

/**
 * 讓底下的元件用 `useConfirm()` 以命令式開啟確認對話框，
 * 不必各自維護「待確認項目」的 state 與一份 `<AlertDialog>`。
 */
export function ConfirmDialogProvider({
  confirmLabel,
  cancelLabel,
  children,
  classNames,
  styles,
  testIds,
}: ConfirmDialogProviderProps) {
  const [options, setOptions] = useState<ConfirmOptions>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // 目前這一次 confirm() 的 resolve；被取代或 settle 之後就不是同一個函式，可用來判斷請求是否過期
  const resolveRef = useRef<((confirmed: boolean) => void) | undefined>(undefined);

  const settle = useCallback((confirmed: boolean) => {
    resolveRef.current?.(confirmed);
    resolveRef.current = undefined;
    setOpen(false);
    setLoading(false);
  }, []);

  const confirm = useCallback<ConfirmFn>(
    (next) =>
      new Promise<boolean>((resolve) => {
        // 同時只會有一個對話框：前一個還沒回答的視為取消
        resolveRef.current?.(false);
        resolveRef.current = resolve;
        setOptions(next);
        setLoading(false);
        setOpen(true);
      }),
    [],
  );

  // Provider 卸載時不讓呼叫端的 await 永遠懸著
  useEffect(() => () => resolveRef.current?.(false), []);

  const handleConfirm = async () => {
    const request = resolveRef.current;
    const action = options?.onConfirm;
    if (action) {
      setLoading(true);
      try {
        await action();
      } catch {
        // 失敗時留在對話框讓使用者決定；錯誤本身由呼叫端或全域處理顯示（見 ConfirmOptions.onConfirm）
        if (resolveRef.current === request) setLoading(false);
        return;
      }
    }
    if (resolveRef.current === request) settle(true);
  };

  return (
    <ConfirmContext value={confirm}>
      {children}
      {options && (
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            if (!next && !loading) settle(false);
          }}
          title={options.title}
          description={options.description}
          confirmLabel={options.confirmLabel ?? confirmLabel}
          cancelLabel={options.cancelLabel ?? cancelLabel}
          tone={options.tone}
          loading={loading}
          onConfirm={handleConfirm}
          className={options.className}
          data-testid={options['data-testid']}
          classNames={classNames}
          styles={styles}
          testIds={testIds}
        />
      )}
    </ConfirmContext>
  );
}

/**
 * 取得 `confirm()`：
 *
 * ```tsx
 * const confirm = useConfirm();
 * const ok = await confirm({ title, description, onConfirm: () => mutation.mutateAsync(vars) });
 * ```
 */
export function useConfirm(): ConfirmFn {
  const confirm = use(ConfirmContext);
  if (!confirm) throw new Error('useConfirm() 必須在 ConfirmDialogProvider 底下使用');
  return confirm;
}

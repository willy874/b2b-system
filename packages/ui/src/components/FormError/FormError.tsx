import { cn } from '@b2b-system/web-shared/utils';
import type { ReactNode, Ref } from 'react';

import styles from './FormError.module.css';

export interface FormErrorProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLParagraphElement>;
  /** 錯誤訊息；沒有時元素仍在（隱藏），之後放進訊息時報讀器比較確定會念出。 */
  children?: ReactNode;
  /**
   * 錯誤的代碼（例：後端的錯誤碼），放在 `data-value`：測試以它分辨是哪一種錯誤，不比對會隨語系變的文字。
   */
  code?: string;
  className?: string;
  'data-testid'?: string;
}

/**
 * 表單層級的錯誤（送出失敗、伺服器錯誤）：`role="alert"`，焦點留在送出鈕上時報讀器也會立即念出
 * （docs/architecture/frontend/07-ui-system.md §5）。欄位自己的錯誤用 `Field` 的 `error`。
 *
 * 常駐渲染、沒有訊息時以 `:empty` 隱藏：live region 先存在、內容改變時，各家報讀器比較確定會播報。
 */
export function FormError({ children, code, className, ...rest }: FormErrorProps) {
  return (
    <p role="alert" className={cn(styles.root, className)} data-value={code} {...rest}>
      {children}
    </p>
  );
}

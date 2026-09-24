import { Children, isValidElement, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** `copyable` 的細部設定；只給 `true` 時全部用預設值。 */
export interface TypographyCopyableConfig {
  /** 要複製的文字；省略時取 children 的純文字（children 含自訂元件時請明確給）。 */
  text?: string;
  /** 複製按鈕的無障礙名稱與提示文字；`features/` 使用時以 `t()` 傳入。 */
  copyLabel?: string;
  /** 複製成功後的無障礙名稱與提示文字；`features/` 使用時以 `t()` 傳入。 */
  copiedLabel?: string;
  /** 顯示「已複製」狀態的毫秒數。 */
  resetAfter?: number;
  /** 設為 `false` 時只靠 `aria-label`，不顯示提示框。 */
  tooltip?: boolean;
  onCopy?: (text: string) => void;
  /** 瀏覽器拒絕寫入剪貼簿時呼叫；此時不會切換成「已複製」。 */
  onError?: (error: unknown) => void;
}

export type TypographyCopyable = boolean | TypographyCopyableConfig;

export const DEFAULT_COPY_RESET_AFTER = 3000;

/** 把 ReactNode 攤平成純文字；元素只取其 `children`，其餘（布林、null）略過。 */
export function getNodeText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (isValidElement<{ children?: ReactNode }>(child)) return getNodeText(child.props.children);
      return '';
    })
    .join('');
}

export function useCopyable(config: TypographyCopyableConfig, children: ReactNode) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    const text = config.text ?? getNodeText(children);
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      // 權限被拒或非安全環境：維持原狀態，是否提示交給呼叫端
      config.onError?.(error);
      return;
    }
    setCopied(true);
    config.onCopy?.(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setCopied(false),
      config.resetAfter ?? DEFAULT_COPY_RESET_AFTER,
    );
  };

  return { copied, copy };
}

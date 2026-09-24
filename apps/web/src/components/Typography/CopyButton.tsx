import type { ReactNode } from 'react';

import { Icon } from '../Icon';
import type { SlotAttributes } from '../slots';
import { Tooltip } from '../Tooltip';
import { useCopyable } from './useCopyable';
import type { TypographyCopyableConfig } from './useCopyable';

interface CopyButtonProps {
  config: TypographyCopyableConfig;
  /** 沒有 `config.text` 時從這裡取純文字。 */
  source: ReactNode;
  /** 已由 `createSlots()` 合併好的 className / style / data-testid。 */
  slotAttributes: SlotAttributes;
}

/** Typography 內部用的複製按鈕；不從 index 匯出。 */
export function CopyButton({ config, source, slotAttributes }: CopyButtonProps) {
  const { copied, copy } = useCopyable(config, source);
  const label = copied ? (config.copiedLabel ?? '已複製') : (config.copyLabel ?? '複製');

  return (
    <Tooltip content={label} disabled={config.tooltip === false}>
      <button
        type="button"
        aria-label={label}
        data-copied={copied || undefined}
        onClick={() => void copy()}
        {...slotAttributes}
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
      </button>
    </Tooltip>
  );
}

import { isSafeLinkHref, normalizeLinkHref } from '@b2b-system/rich-text';
import { useId, useState } from 'react';

import { Button } from '../Button';
import { Input } from '../Input';
import type { RichTextEditorTextLabels } from '../labels';
import type { SlotAttributes } from '../slots';

import styles from './RichTextEditor.module.css';

interface LinkBarProps {
  labels: RichTextEditorTextLabels;
  /** 游標所在的連結目前的網址；不在連結上時是空字串。 */
  initialHref: string;
  /** 套用檢查過的網址（已補上協定、已通過 `isSafeLinkHref`）。 */
  onApply: (href: string) => void;
  /** 游標在連結上時才有「移除連結」。 */
  onRemove: (() => void) | undefined;
  /** 取消（Esc 或取消鈕）：關閉連結列，焦點回到編輯區。 */
  onCancel: () => void;
  slotAttributes: SlotAttributes;
}

/**
 * 編輯連結：工具列下方的一列（網址輸入框 ＋ 套用／移除／取消），打開時聚焦輸入框。
 * 不用 Popover：連結按鈕可能被收進工具列的「更多」下拉，沒有固定的位置可以對齊。
 */
export function LinkBar({
  labels,
  initialHref,
  onApply,
  onRemove,
  onCancel,
  slotAttributes,
}: LinkBarProps) {
  const [text, setText] = useState(initialHref);
  const [isInvalid, setIsInvalid] = useState(false);
  const errorId = useId();

  const apply = () => {
    const href = normalizeLinkHref(text);
    if (!isSafeLinkHref(href)) {
      setIsInvalid(true);
      return;
    }
    onApply(href);
  };

  return (
    <fieldset aria-label={labels.link} {...slotAttributes}>
      <div className={styles.linkRow}>
        <Input
          size="sm"
          className={styles.linkInput}
          type="url"
          inputMode="url"
          value={text}
          placeholder="https://"
          aria-label={labels.linkUrl}
          aria-invalid={isInvalid || undefined}
          aria-describedby={isInvalid ? errorId : undefined}
          data-testid="rich-text-editor-link-input"
          // 連結列打開就是要輸入網址
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          onChange={(event) => {
            setText(event.target.value);
            setIsInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              apply();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
        />
        <Button
          size="sm"
          variant="primary"
          onClick={apply}
          data-testid="rich-text-editor-link-apply"
        >
          {labels.linkApply}
        </Button>
        {onRemove && (
          <Button size="sm" onClick={onRemove} data-testid="rich-text-editor-link-remove">
            {labels.linkRemove}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {labels.linkCancel}
        </Button>
      </div>
      {isInvalid && (
        <p id={errorId} role="alert" className={styles.linkError}>
          {labels.linkInvalid}
        </p>
      )}
    </fieldset>
  );
}

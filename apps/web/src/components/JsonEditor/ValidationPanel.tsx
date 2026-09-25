import { formatPath } from '../JsonViewer/jsonLines';
import type { SlotAttributes } from '../slots';
import { formatDisplayPath } from './displayPath';
import type { JsonValidationError } from './validation';

import styles from './JsonEditor.module.css';

interface ValidationPanelProps {
  errors: readonly JsonValidationError[];
  /** 點一筆錯誤：切到樹狀、展開並捲到那一行。文字模式的內容不合法時不能跳（`disabled`）。 */
  onSelect: (error: JsonValidationError) => void;
  disabled: boolean;
  labels: { validationErrors: (count: number) => string; rootPath: string };
  slotAttributes: SlotAttributes;
}

/** 編輯區下方的驗證錯誤清單（對應 svelte-jsoneditor 的 validation errors 面板）。 */
export function ValidationPanel({
  errors,
  onSelect,
  disabled,
  labels,
  slotAttributes,
}: ValidationPanelProps) {
  const title = labels.validationErrors(errors.length);
  return (
    <section aria-label={title} {...slotAttributes}>
      <p className={styles.validationTitle}>{title}</p>
      <ul className={styles.validationList}>
        {errors.map((error) => {
          const path = formatPath(error.path);
          return (
            // 同一個節點可能有好幾個錯誤：以關鍵字與訊息區分
            <li key={`${path}/${error.keyword}/${error.message}`}>
              <button
                type="button"
                className={styles.validationItem}
                disabled={disabled}
                onClick={() => onSelect(error)}
                data-testid="json-editor-validation-item"
                data-value={path}
              >
                <code className={styles.validationPath}>
                  {formatDisplayPath(error.path, labels.rootPath)}
                </code>
                <span>{error.message}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

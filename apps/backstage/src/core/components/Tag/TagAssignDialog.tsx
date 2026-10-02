import { useState } from 'react';

import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Select } from '@/components/Select';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { Tag, TagSummary } from '@/shared/api-sdk';

/** 一個資源最多貼幾個標籤；與後端的 `TAG_MAX_PER_RESOURCE` 一致（docs/adr/0032-tags.md D11）。 */
export const TAG_MAX_PER_RESOURCE = 20;

export interface TagAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 對話框標題，通常帶資源名稱（例：「標籤：合約.pdf」）。 */
  title: string;
  /** 這個標籤組的全部標籤；還沒載入時是 undefined。 */
  options: readonly Tag[] | undefined;
  /** 目前貼著的標籤（開啟時的起點）。 */
  value: readonly TagSummary[];
  /** 送出整批取代；失敗丟錯（訊息顯示在對話框裡）。 */
  onSave: (tagIds: string[]) => Promise<unknown>;
  'data-testid'?: string;
}

/**
 * 貼與移除標籤（docs/adr/0032-tags.md D7）：從標籤組的定義裡多選，整批取代。
 * 沒有任何標籤時說明要先到標籤管理建立；能不能改由呼叫端決定要不要打開它（後端會再檢查）。
 */
export function TagAssignDialog({
  open,
  onOpenChange,
  title,
  options,
  value,
  onSave,
  'data-testid': testId = 'tag-assign-dialog',
}: TagAssignDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  // 每次打開都從目前貼著的標籤開始（render 期間調整 state，不經過 effect）
  const [openedWith, setOpenedWith] = useState<readonly TagSummary[]>();
  if (open && openedWith !== value) {
    setOpenedWith(value);
    setSelected(value.map((tag) => tag.id));
    setError(undefined);
  } else if (!open && openedWith !== undefined) {
    setOpenedWith(undefined);
  }

  const full = selected.length >= TAG_MAX_PER_RESOURCE;
  const selectOptions = (options ?? []).map((tag) => ({
    value: tag.id,
    label: tag.name,
    textValue: tag.name,
    disabled: full && !selected.includes(tag.id),
  }));

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await onSave(selected);
      onOpenChange(false);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      data-testid={testId}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            loading={saving}
            disabled={!options}
            data-testid="tag-assign-save"
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {options && options.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-fg-muted)]" data-testid="tag-assign-empty">
            {t('tag.assign.noTags')}
          </p>
        ) : (
          <Select
            multiple
            searchable
            valueOrder="options"
            options={selectOptions}
            value={selected}
            onValueChange={setSelected}
            loading={!options}
            placeholder={t('tag.assign.placeholder')}
            searchPlaceholder={t('tag.assign.search')}
            aria-label={title}
            data-testid="tag-assign-select"
          />
        )}
        <p className="m-0 text-xs text-[var(--color-fg-muted)]">
          {t('tag.assign.hint', { max: TAG_MAX_PER_RESOURCE })}
        </p>
        {/* role="alert"：送出失敗時報讀器會立即念出 */}
        <p role="alert" className="m-0 text-sm text-[var(--color-danger-text)] empty:hidden">
          {error}
        </p>
      </div>
    </Dialog>
  );
}

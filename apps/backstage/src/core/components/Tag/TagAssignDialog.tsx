import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Select } from '@b2b-system/ui/Select';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useState } from 'react';

import type { Tag, TagSummary } from '@/shared/api-sdk';

/** 一個資源最多貼幾個標籤；與後端的 `TAG_MAX_PER_RESOURCE` 一致（docs/architecture/backend/18-tag.md §7.2 D11）。 */
export const TAG_MAX_PER_RESOURCE = 20;

export interface TagAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 對話框標題，通常帶資源名稱（例：「標籤：合約.pdf」）。 */
  title: string;
  /** 這個標籤組的全部標籤；還沒載入時是 undefined。 */
  options: readonly Tag[] | undefined;
  /** 目前貼著的標籤：開啟的那一刻是選擇的起點；開啟中改變（別人改了）只提示，不覆寫選擇。 */
  value: readonly TagSummary[];
  /** 送出整批取代；失敗丟錯（訊息顯示在對話框裡）。 */
  onSave: (tagIds: string[]) => Promise<unknown>;
  'data-testid'?: string;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const rightIds = new Set(right);
  return left.length === right.length && left.every((id) => rightIds.has(id));
}

/**
 * 貼與移除標籤（docs/architecture/backend/18-tag.md §7.2 D7）：從標籤組的定義裡多選，整批取代。
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
  const current = value.map((tag) => tag.id);

  // 只在打開的那一刻（open 從 false 變 true）從目前貼著的標籤開始（render 期間調整 state，不經過 effect）。
  // 開啟中 `value` 變了（推播讓資料重抓）不覆寫選擇，否則正在選的內容會被默默清掉
  const [base, setBase] = useState<readonly string[]>();
  if (open && base === undefined) {
    setBase(current);
    setSelected(current);
    setError(undefined);
  } else if (!open && base !== undefined) {
    setBase(undefined);
  }
  /** 打開之後別人改了這個資源的標籤：提示，讓使用者決定要不要改用最新的。 */
  const isStale = base !== undefined && !sameIds(base, current);
  const applyLatest = () => {
    setBase(current);
    setSelected(current);
  };

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
        {isStale && (
          <div
            className="flex items-center justify-between gap-2 text-xs text-[var(--color-fg-muted)]"
            data-testid="tag-assign-stale"
          >
            <span>{t('tag.assign.stale')}</span>
            <Button size="sm" onClick={applyLatest} data-testid="tag-assign-use-latest">
              {t('tag.assign.useLatest')}
            </Button>
          </div>
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

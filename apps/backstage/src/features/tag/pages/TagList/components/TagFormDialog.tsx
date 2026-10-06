import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Field } from '@b2b-system/ui/Field';
import { Input } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { isVersionConflict, useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useDialogUnsavedGuard } from '@b2b-system/web-core/router';
import { useId, useState } from 'react';

import { TagChips, VersionConflictAlert } from '@/core/components';
import type { Tag } from '@/shared/api-sdk';

import { TAG_COLOR_LABEL_KEY, TAG_COLORS, TAG_NAME_MAX_LENGTH } from '../../../constants';

type TagColor = Tag['color'];

interface TagFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 編輯的標籤；沒有就是建立。 */
  tag?: Tag;
  /** 送出；失敗丟錯（訊息顯示在對話框裡，含版本衝突）。 */
  onSubmit: (values: { name: string; color: TagColor }) => Promise<unknown>;
  /**
   * 版本衝突後的「重新載入」：呼叫端取得最新的那一筆並換掉 `tag`（含 `version`），表單以它重設。
   * 失敗丟錯（訊息顯示在對話框裡）。
   */
  onReload: () => Promise<unknown>;
}

/**
 * 建立或編輯標籤：名稱與顏色（Design Token 的名稱，docs/architecture/backend/18-tag.md §7.2 D3），右側即時預覽。
 * 編輯時別人搶先改過（409 `TAG_VERSION_CONFLICT`）：以 `VersionConflictAlert` 說明並提供「重新載入」，
 * 輸入留著讓使用者先記下自己的修改（docs/architecture/backend/03-api-conventions.md §11）。
 */
export function TagFormDialog({ open, onOpenChange, tag, onSubmit, onReload }: TagFormDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const formId = useId();
  const [name, setName] = useState('');
  const [color, setColor] = useState<TagColor>('neutral');
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<unknown>();

  // 每次打開都從那個標籤（或空白）開始（render 期間調整 state，不經過 effect）
  const [openedFor, setOpenedFor] = useState<{ tag: Tag | undefined }>();
  if (open && openedFor?.tag !== tag) {
    setOpenedFor({ tag });
    setName(tag?.name ?? '');
    setColor(tag?.color ?? 'neutral');
    setError(undefined);
  } else if (!open && openedFor !== undefined) {
    setOpenedFor(undefined);
  }

  const submit = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await onSubmit({ name: name.trim(), color });
      onOpenChange(false);
    } catch (caught) {
      setError(caught);
    } finally {
      setSaving(false);
    }
  };

  /** 放棄這次的修改：呼叫端換成最新的那一筆，上面以新的 `tag` 重設表單（含清掉錯誤）。 */
  const reload = async () => {
    setReloading(true);
    try {
      await onReload();
    } catch (caught) {
      setError(caught);
    } finally {
      setReloading(false);
    }
  };
  const conflict = isVersionConflict(error);
  // 有改動時 Esc、點遮罩、取消與換頁都先確認；儲存成功直接關閉
  const guard = useDialogUnsavedGuard(
    open && (name !== (tag?.name ?? '') || color !== (tag?.color ?? 'neutral')),
    () => onOpenChange(false),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={guard.onOpenChange}
      title={tag ? t('tagAdmin.edit.title') : t('tagAdmin.create.title')}
      size="sm"
      data-testid="tag-form-dialog"
      footer={
        <>
          <Button onClick={guard.requestClose} data-testid="tag-form-cancel">
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={!name.trim()}
            loading={saving}
            data-testid="tag-form-submit"
          >
            {tag ? t('common.save') : t('common.create')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t('tagAdmin.field.name')} required>
          <Input
            value={name}
            maxLength={TAG_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            data-testid="tag-name-input"
          />
        </Field>
        <Field label={t('tagAdmin.field.color')}>
          <Select
            options={TAG_COLORS.map((value) => ({
              value,
              label: (
                <TagChips
                  tags={[{ id: value, name: t(TAG_COLOR_LABEL_KEY[value]), color: value }]}
                />
              ),
              textValue: t(TAG_COLOR_LABEL_KEY[value]),
            }))}
            value={color}
            onValueChange={setColor}
            aria-label={t('tagAdmin.field.color')}
            data-testid="tag-color-select"
          />
        </Field>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[var(--color-fg-muted)]">{t('tagAdmin.field.preview')}</span>
          <TagChips
            tags={[{ id: 'preview', name: name.trim() || t('tagAdmin.field.name'), color }]}
          />
        </div>
        {conflict && (
          <VersionConflictAlert
            error={error}
            onReload={() => void reload()}
            reloading={reloading}
          />
        )}
        {/* role="alert"：送出失敗時報讀器會立即念出 */}
        <p role="alert" className="m-0 text-sm text-[var(--color-danger-text)] empty:hidden">
          {error !== undefined && !conflict ? toMessage(error) : null}
        </p>
      </form>
    </Dialog>
  );
}

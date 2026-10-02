import { useId, useState } from 'react';

import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { TagChips } from '@/core/components';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
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
}

/** 建立或編輯標籤：名稱與顏色（Design Token 的名稱，docs/architecture/backend/18-tag.md §7.2 D3），右側即時預覽。 */
export function TagFormDialog({ open, onOpenChange, tag, onSubmit }: TagFormDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const formId = useId();
  const [name, setName] = useState('');
  const [color, setColor] = useState<TagColor>('neutral');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

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
      setError(toMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={tag ? t('tagAdmin.edit.title') : t('tagAdmin.create.title')}
      size="sm"
      data-testid="tag-form-dialog"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
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
        {/* role="alert"：送出失敗時報讀器會立即念出 */}
        <p role="alert" className="m-0 text-sm text-[var(--color-danger-text)] empty:hidden">
          {error}
        </p>
      </form>
    </Dialog>
  );
}

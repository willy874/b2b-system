import { Field } from '@b2b-system/ui/Field';
import { Input } from '@b2b-system/ui/Input';
import { LazyRichTextEditor } from '@b2b-system/ui/LazyRichTextEditor';
import type { RichTextDocument } from '@b2b-system/ui/RichTextViewer';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { AnnouncementAudience } from '@/shared/api-sdk';

import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX } from '../constants';
import { AudiencePicker } from './AudiencePicker';
import type { TriggerDraft } from './triggerDraft';
import { TriggerField } from './TriggerField';

/** 表單的草稿（建立與編輯共用）。 */
export interface AnnouncementDraft {
  title: string;
  /** 富文本（docs/architecture/backend/19-announcement.md §9.2 D22）。 */
  body: RichTextDocument;
  audience: AnnouncementAudience;
  trigger: TriggerDraft;
}

interface AnnouncementFormProps {
  id: string;
  value: AnnouncementDraft;
  onChange: (value: AnnouncementDraft) => void;
  onSubmit: () => void;
  /** 已送出（排程中、暫停中）的公告只能改時間，不能改成「立即」。 */
  allowImmediate: boolean;
  disabled?: boolean;
}

/**
 * 標題、富文本內文、受眾、發送時間（docs/architecture/backend/19-announcement.md §9）。
 * 內文的編輯器延遲載入（`LazyRichTextEditor`）：Tiptap 只在打開表單時才下載，列表與詳情頁不含它。
 */
export function AnnouncementForm({
  id,
  value,
  onChange,
  onSubmit,
  allowImmediate,
  disabled,
}: AnnouncementFormProps) {
  const { t } = useTranslation();
  return (
    <form
      id={id}
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Field label={t('announcement.field.title')} required>
        <Input
          value={value.title}
          maxLength={ANNOUNCEMENT_TITLE_MAX}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, title: event.target.value })}
          data-testid="announcement-title-input"
        />
      </Field>
      <Field
        label={t('announcement.field.body')}
        description={t('announcement.field.bodyHint', { max: ANNOUNCEMENT_BODY_MAX })}
        required
      >
        <LazyRichTextEditor
          value={value.body}
          maxLength={ANNOUNCEMENT_BODY_MAX}
          minHeight="8rem"
          maxHeight="24rem"
          disabled={disabled}
          onChange={(body) => onChange({ ...value, body })}
          data-testid="announcement-body-input"
        />
      </Field>
      <Field label={t('announcement.field.audience')} required>
        <AudiencePicker
          value={value.audience}
          eventTriggered={value.trigger.kind === 'event'}
          disabled={disabled}
          onChange={(audience) => onChange({ ...value, audience })}
        />
      </Field>
      <Field label={t('announcement.field.trigger')} required>
        <TriggerField
          value={value.trigger}
          allowImmediate={allowImmediate}
          disabled={disabled}
          onChange={(trigger) => onChange({ ...value, trigger })}
        />
      </Field>
    </form>
  );
}

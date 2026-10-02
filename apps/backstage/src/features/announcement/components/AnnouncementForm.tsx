import { Field } from '@/components/Field';
import { Input, Textarea } from '@/components/Input';
import { useTranslation } from '@/core/locales';
import type { AnnouncementAudience } from '@/shared/api-sdk';

import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX } from '../constants';
import { AudiencePicker } from './AudiencePicker';
import { TriggerField } from './TriggerField';
import type { TriggerDraft } from './TriggerField';

/** 表單的草稿（建立與編輯共用）。 */
export interface AnnouncementDraft {
  title: string;
  body: string;
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

/** 標題、純文字內文、受眾、發送時間（docs/architecture/backend/19-announcement.md §9）。 */
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
        <Textarea
          rows={6}
          value={value.body}
          maxLength={ANNOUNCEMENT_BODY_MAX}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, body: event.target.value })}
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

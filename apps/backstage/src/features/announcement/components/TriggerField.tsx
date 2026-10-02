import dayjs from 'dayjs';

import { DatePicker, formatDate } from '@/components/DatePicker';
import { Input } from '@/components/Input';
import { RadioGroup } from '@/components/Radio';
import { useTranslation } from '@/core/locales';
import type { AnnouncementTrigger } from '@/shared/api-sdk';
import { getDateTimeDefaults, toZonedParts, zonedDateTime } from '@/shared/date';

import { TRIGGER_KIND_LABEL_KEY } from '../constants';

type TriggerKind = AnnouncementTrigger['kind'];

/** 表單裡的觸發方式：指定時間以偏好時區的日期與時間編輯，送出前才換成 ISO。 */
export interface TriggerDraft {
  kind: TriggerKind;
  day: string;
  time: string;
}

export function toTriggerDraft(trigger: AnnouncementTrigger): TriggerDraft {
  if (trigger.kind === 'immediate') return { kind: 'immediate', day: '', time: '09:00' };
  const parts = toZonedParts(trigger.at);
  return { kind: 'once', day: parts?.day ?? '', time: parts?.time ?? '09:00' };
}

/** 草稿 → API 的觸發方式；指定時間缺日期或格式不對回 `undefined`（表單不能送出）。 */
export function fromTriggerDraft(draft: TriggerDraft): AnnouncementTrigger | undefined {
  if (draft.kind === 'immediate') return { kind: 'immediate' };
  const at = zonedDateTime(draft.day, draft.time);
  return at ? { kind: 'once', at } : undefined;
}

interface TriggerFieldProps {
  value: TriggerDraft;
  onChange: (value: TriggerDraft) => void;
  /** 已送出的公告只能改時間，不能改成「立即」。 */
  allowImmediate: boolean;
  disabled?: boolean;
}

/** 發送時間（docs/adr/0031-announcements.md D7）：立即，或指定的日期與時間（偏好的時區）。 */
export function TriggerField({ value, onChange, allowImmediate, disabled }: TriggerFieldProps) {
  const { t } = useTranslation();
  const kinds: TriggerKind[] = allowImmediate ? ['immediate', 'once'] : ['once'];
  return (
    <div className="flex flex-col gap-2" data-testid="announcement-trigger">
      <RadioGroup
        orientation="horizontal"
        value={value.kind}
        disabled={disabled}
        onValueChange={(kind) => onChange({ ...value, kind })}
        options={kinds.map((kind) => ({ value: kind, label: t(TRIGGER_KIND_LABEL_KEY[kind]) }))}
        aria-label={t('announcement.field.trigger')}
        data-testid="announcement-trigger-kind"
      />
      {value.kind === 'once' && (
        <div className="flex flex-wrap items-center gap-2">
          <DatePicker
            value={value.day || null}
            onValueChange={(day) => onChange({ ...value, day: day ?? '' })}
            min={formatDate(dayjs())}
            disabled={disabled}
            aria-label={t('announcement.trigger.day')}
            data-testid="announcement-trigger-day"
          />
          <Input
            type="time"
            className="w-32"
            value={value.time}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, time: event.target.value })}
            aria-label={t('announcement.trigger.time')}
            data-testid="announcement-trigger-time"
          />
          <span className="text-xs text-[var(--color-fg-muted)]">
            {t('announcement.trigger.timeZone', { timeZone: getDateTimeDefaults().timeZone })}
          </span>
        </div>
      )}
    </div>
  );
}

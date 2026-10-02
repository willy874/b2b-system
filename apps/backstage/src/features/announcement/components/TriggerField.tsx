import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { getAnnouncementRecurrencePreviewQueryOptions } from '@/apis/announcement/preview-announcement-recurrence/query';
import { Checkbox } from '@/components/Checkbox';
import { DatePicker, formatDate } from '@/components/DatePicker';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { NumberField } from '@/components/NumberField';
import { RadioGroup } from '@/components/Radio';
import { Select } from '@/components/Select';
import { useTranslation } from '@/core/locales';
import type { AnnouncementTrigger } from '@/shared/api-sdk';
import { formatDateTime, getDateTimeDefaults, toZonedParts, zonedDateTime } from '@/shared/date';

import {
  FREQUENCY_LABEL_KEY,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_MAX_INTERVAL,
  TRIGGER_KIND_LABEL_KEY,
  WEEKDAY_LABEL_KEY,
  WEEKDAY_ORDER,
} from '../constants';
import type { RecurrenceFrequency } from '../constants';

type TriggerKind = AnnouncementTrigger['kind'];
type RecurringTrigger = Extract<AnnouncementTrigger, { kind: 'recurring' }>;

/**
 * 表單裡的觸發方式。指定時間以使用者偏好的時區編輯、送出前換成 ISO；
 * 週期的日期與時間是 **租戶時區** 的日曆（後端依它計算，D11），原樣送出。
 */
export interface TriggerDraft {
  kind: TriggerKind;
  /** 指定時間的日期（偏好時區）。 */
  day: string;
  /** 指定時間的時間（偏好時區），或週期每次的時間（租戶時區）。 */
  time: string;
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays: number[];
  monthDay: number | 'last';
  startsOn: string;
  endsOn: string;
  maxOccurrences: number | null;
}

export const EMPTY_TRIGGER_DRAFT: TriggerDraft = {
  kind: 'immediate',
  day: '',
  time: '09:00',
  frequency: 'weekly',
  interval: 1,
  weekdays: [1],
  monthDay: 1,
  startsOn: '',
  endsOn: '',
  maxOccurrences: null,
};

export function toTriggerDraft(trigger: AnnouncementTrigger): TriggerDraft {
  switch (trigger.kind) {
    case 'immediate':
      return EMPTY_TRIGGER_DRAFT;
    case 'once': {
      const parts = toZonedParts(trigger.at);
      return {
        ...EMPTY_TRIGGER_DRAFT,
        kind: 'once',
        day: parts?.day ?? '',
        time: parts?.time ?? '09:00',
      };
    }
    case 'recurring':
      return {
        ...EMPTY_TRIGGER_DRAFT,
        kind: 'recurring',
        time: trigger.time,
        frequency: trigger.frequency,
        interval: trigger.interval,
        weekdays: trigger.weekdays ?? [],
        monthDay: trigger.monthDay ?? 1,
        startsOn: trigger.startsOn,
        endsOn: trigger.endsOn ?? '',
        maxOccurrences: trigger.maxOccurrences ?? null,
      };
  }
}

/** 草稿 → 週期；缺必要欄位回 `undefined`。 */
function toRecurring(draft: TriggerDraft): RecurringTrigger | undefined {
  if (!draft.startsOn || !/^\d{2}:\d{2}$/.test(draft.time)) return undefined;
  if (draft.frequency === 'weekly' && draft.weekdays.length === 0) return undefined;
  if (draft.endsOn && draft.endsOn < draft.startsOn) return undefined;
  return {
    kind: 'recurring',
    frequency: draft.frequency,
    interval: draft.interval,
    time: draft.time,
    startsOn: draft.startsOn,
    endsOn: draft.endsOn || null,
    maxOccurrences: draft.maxOccurrences,
    ...(draft.frequency === 'weekly' && { weekdays: draft.weekdays.toSorted() }),
    ...(draft.frequency === 'monthly' && { monthDay: draft.monthDay }),
  };
}

/** 草稿 → API 的觸發方式；缺欄位或格式不對回 `undefined`（表單不能送出）。 */
export function fromTriggerDraft(draft: TriggerDraft): AnnouncementTrigger | undefined {
  switch (draft.kind) {
    case 'immediate':
      return { kind: 'immediate' };
    case 'once': {
      const at = zonedDateTime(draft.day, draft.time);
      return at ? { kind: 'once', at } : undefined;
    }
    case 'recurring':
      return toRecurring(draft);
  }
}

interface TriggerFieldProps {
  value: TriggerDraft;
  onChange: (value: TriggerDraft) => void;
  /** 已送出的公告不能改成「立即」。 */
  allowImmediate: boolean;
  disabled?: boolean;
}

/** 發送時間（docs/adr/0031-announcements.md D7）：立即、指定時間、週期。 */
export function TriggerField({ value, onChange, allowImmediate, disabled }: TriggerFieldProps) {
  const { t } = useTranslation();
  const kinds: TriggerKind[] = allowImmediate
    ? ['immediate', 'once', 'recurring']
    : ['once', 'recurring'];
  const patch = (next: Partial<TriggerDraft>) => onChange({ ...value, ...next });
  const today = formatDate(dayjs());

  return (
    <div className="flex flex-col gap-3" data-testid="announcement-trigger">
      <RadioGroup
        orientation="horizontal"
        value={value.kind}
        disabled={disabled}
        onValueChange={(kind) =>
          patch({ kind, ...(kind === 'recurring' && !value.startsOn && { startsOn: today }) })
        }
        options={kinds.map((kind) => ({ value: kind, label: t(TRIGGER_KIND_LABEL_KEY[kind]) }))}
        aria-label={t('announcement.field.trigger')}
        data-testid="announcement-trigger-kind"
      />
      {value.kind === 'once' && (
        <div className="flex flex-wrap items-center gap-2">
          <DatePicker
            value={value.day || null}
            onValueChange={(day) => patch({ day: day ?? '' })}
            min={today}
            disabled={disabled}
            aria-label={t('announcement.trigger.day')}
            data-testid="announcement-trigger-day"
          />
          <TimeInput value={value.time} disabled={disabled} onChange={(time) => patch({ time })} />
          <span className="text-xs text-[var(--color-fg-muted)]">
            {t('announcement.trigger.timeZone', { timeZone: getDateTimeDefaults().timeZone })}
          </span>
        </div>
      )}
      {value.kind === 'recurring' && (
        <RecurrenceFields value={value} patch={patch} disabled={disabled} today={today} />
      )}
    </div>
  );
}

interface TimeInputProps {
  value: string;
  onChange: (time: string) => void;
  disabled?: boolean;
}

function TimeInput({ value, onChange, disabled }: TimeInputProps) {
  const { t } = useTranslation();
  return (
    <Input
      type="time"
      className="w-32"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      aria-label={t('announcement.trigger.time')}
      data-testid="announcement-trigger-time"
    />
  );
}

interface RecurrenceFieldsProps {
  value: TriggerDraft;
  patch: (next: Partial<TriggerDraft>) => void;
  disabled?: boolean;
  today: string;
}

/** 預覽查詢停用時的佔位（`enabled: false` 不會送出）。 */
const PLACEHOLDER_RECURRING: RecurringTrigger = {
  kind: 'recurring',
  frequency: 'daily',
  interval: 1,
  time: '09:00',
  startsOn: '2000-01-01',
};

/** 週期的設定與「接下來 5 次」的預覽（伺服器依租戶時區計算）。 */
function RecurrenceFields({ value, patch, disabled, today }: RecurrenceFieldsProps) {
  const { t } = useTranslation();
  const recurring = toRecurring(value);
  const preview = useQuery({
    ...getAnnouncementRecurrencePreviewQueryOptions(recurring ?? PLACEHOLDER_RECURRING),
    enabled: Boolean(recurring),
  });

  return (
    <div className="flex flex-col gap-3" data-testid="announcement-recurrence">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{t('announcement.recurrence.every')}</span>
        <NumberField
          className="w-24"
          value={value.interval}
          min={1}
          max={RECURRENCE_MAX_INTERVAL}
          disabled={disabled}
          onValueChange={(interval) => patch({ interval: interval ?? 1 })}
          aria-label={t('announcement.recurrence.interval')}
        />
        <Select
          className="w-28"
          aria-label={t('announcement.recurrence.frequencyLabel')}
          options={RECURRENCE_FREQUENCIES.map((frequency) => ({
            value: frequency,
            label: t(FREQUENCY_LABEL_KEY[frequency]),
          }))}
          value={value.frequency}
          disabled={disabled}
          onValueChange={(frequency) => patch({ frequency })}
          data-testid="announcement-recurrence-frequency"
        />
        <TimeInput value={value.time} disabled={disabled} onChange={(time) => patch({ time })} />
      </div>

      {value.frequency === 'weekly' && (
        <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
          <legend className="sr-only">{t('announcement.recurrence.weekdays')}</legend>
          {WEEKDAY_ORDER.map((weekday) => (
            <Checkbox
              key={weekday}
              label={t(WEEKDAY_LABEL_KEY[weekday])}
              checked={value.weekdays.includes(weekday)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                patch({
                  weekdays: checked
                    ? [...value.weekdays, weekday]
                    : value.weekdays.filter((day) => day !== weekday),
                })
              }
              data-testid="announcement-recurrence-weekday"
            />
          ))}
        </fieldset>
      )}

      {value.frequency === 'monthly' && (
        <Select
          className="w-40"
          aria-label={t('announcement.recurrence.monthDay')}
          options={[
            ...Array.from({ length: 28 }, (_, index) => ({
              value: String(index + 1),
              label: t('announcement.recurrence.dayOfMonth', { day: index + 1 }),
            })),
            { value: 'last', label: t('announcement.recurrence.lastDay') },
          ]}
          value={String(value.monthDay)}
          disabled={disabled}
          onValueChange={(day) => patch({ monthDay: day === 'last' ? 'last' : Number(day) })}
          data-testid="announcement-recurrence-month-day"
        />
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('announcement.recurrence.startsOn')}>
          <DatePicker
            value={value.startsOn || null}
            onValueChange={(day) => patch({ startsOn: day ?? '' })}
            clearable={false}
            disabled={disabled}
            aria-label={t('announcement.recurrence.startsOn')}
            data-testid="announcement-recurrence-starts-on"
          />
        </Field>
        <Field label={t('announcement.recurrence.endsOn')}>
          <DatePicker
            value={value.endsOn || null}
            onValueChange={(day) => patch({ endsOn: day ?? '' })}
            min={value.startsOn || today}
            disabled={disabled}
            placeholder={t('announcement.recurrence.noEnd')}
            aria-label={t('announcement.recurrence.endsOn')}
            data-testid="announcement-recurrence-ends-on"
          />
        </Field>
        <Field label={t('announcement.recurrence.maxOccurrences')}>
          <NumberField
            className="w-28"
            value={value.maxOccurrences}
            min={1}
            disabled={disabled}
            placeholder={t('announcement.recurrence.unlimited')}
            onValueChange={(maxOccurrences) => patch({ maxOccurrences })}
            aria-label={t('announcement.recurrence.maxOccurrences')}
          />
        </Field>
      </div>

      <div className="text-sm" data-testid="announcement-recurrence-preview">
        {preview.data && recurring ? (
          <>
            <p className="m-0 text-[var(--color-fg-muted)]">
              {t('announcement.recurrence.preview', { timeZone: preview.data.timeZone })}
            </p>
            {preview.data.occurrences.length ? (
              <ul className="m-0 mt-1 pl-5">
                {preview.data.occurrences.map((at) => (
                  <li key={at}>{formatDateTime(at)}</li>
                ))}
              </ul>
            ) : (
              <p className="m-0 mt-1">{t('announcement.recurrence.noOccurrence')}</p>
            )}
          </>
        ) : (
          <p className="m-0 text-[var(--color-fg-muted)]">
            {t('announcement.recurrence.incomplete')}
          </p>
        )}
      </div>
    </div>
  );
}

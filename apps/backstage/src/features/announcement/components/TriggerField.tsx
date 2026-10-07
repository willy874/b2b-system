import { Checkbox } from '@b2b-system/ui/Checkbox';
import { DatePicker } from '@b2b-system/ui/DatePicker';
import { Field } from '@b2b-system/ui/Field';
import { Input } from '@b2b-system/ui/Input';
import { NumberField } from '@b2b-system/ui/NumberField';
import { RadioGroup } from '@b2b-system/ui/Radio';
import { Select } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime, getDateTimeDefaults, todayInZone } from '@b2b-system/web-shared/date';
import { useQuery } from '@tanstack/react-query';

import { getAnnouncementTriggerEventsQueryOptions } from '@/apis/announcement/get-announcement-trigger-events/query';
import { getAnnouncementRecurrencePreviewQueryOptions } from '@/apis/announcement/preview-announcement-recurrence/query';

import {
  ANNOUNCEMENT_EVENT_LABEL,
  DELAY_UNIT_LABEL_KEY,
  DELAY_UNITS,
  FREQUENCY_LABEL_KEY,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_MAX_INTERVAL,
  TRIGGER_KIND_LABEL_KEY,
  WEEKDAY_LABEL_KEY,
  WEEKDAY_ORDER,
} from '../constants';
import { toRecurring } from './triggerDraft';
import type { RecurringTrigger, TriggerDraft, TriggerKind } from './triggerDraft';

interface TriggerFieldProps {
  value: TriggerDraft;
  onChange: (value: TriggerDraft) => void;
  /** 已送出的公告不能改成「立即」。 */
  allowImmediate: boolean;
  disabled?: boolean;
}

/** 發送時間（docs/architecture/backend/19-announcement.md §9.2 D7）：立即、指定時間、週期。 */
export function TriggerField({ value, onChange, allowImmediate, disabled }: TriggerFieldProps) {
  const { t } = useTranslation();
  const kinds: TriggerKind[] = allowImmediate
    ? ['immediate', 'once', 'recurring', 'event']
    : ['once', 'recurring', 'event'];
  const patch = (next: Partial<TriggerDraft>) => onChange({ ...value, ...next });
  // 「今天」是偏好時區的今天：指定時間以偏好時區輸入（fromTriggerDraft 的 zonedDateTime），不是瀏覽器的時區
  const today = todayInZone();

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
      {value.kind === 'event' && <EventFields value={value} patch={patch} disabled={disabled} />}
    </div>
  );
}

interface EventFieldsProps {
  value: TriggerDraft;
  patch: (next: Partial<TriggerDraft>) => void;
  disabled?: boolean;
}

/** 事件點（D12～D14）：選觸發點、延遲多久；說明受眾怎麼比對。 */
function EventFields({ value, patch, disabled }: EventFieldsProps) {
  const { t } = useTranslation();
  const events = useQuery(getAnnouncementTriggerEventsQueryOptions());
  const selected = events.data?.items.find((item) => item.event === value.event);
  const label = selected && ANNOUNCEMENT_EVENT_LABEL[selected.event];
  return (
    <div className="flex flex-col gap-2" data-testid="announcement-event">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-64"
          aria-label={t('announcement.event.label')}
          placeholder={t('announcement.event.placeholder')}
          options={(events.data?.items ?? []).map((item) => {
            const known = ANNOUNCEMENT_EVENT_LABEL[item.event];
            return { value: item.event, label: known ? t(known.nameKey) : item.event };
          })}
          value={value.event || null}
          loading={events.isFetching}
          disabled={disabled}
          onValueChange={(event) => patch({ event })}
          data-testid="announcement-event-select"
        />
        <span className="text-sm">{t('announcement.delay.after')}</span>
        <NumberField
          className="w-24"
          value={value.delayValue}
          min={0}
          disabled={disabled}
          onValueChange={(delayValue) => patch({ delayValue: delayValue ?? 0 })}
          aria-label={t('announcement.delay.value')}
        />
        <Select
          className="w-24"
          aria-label={t('announcement.delay.unitLabel')}
          options={DELAY_UNITS.map((unit) => ({
            value: unit,
            label: t(DELAY_UNIT_LABEL_KEY[unit]),
          }))}
          value={value.delayUnit}
          disabled={disabled}
          onValueChange={(delayUnit) => patch({ delayUnit })}
          data-testid="announcement-delay-unit"
        />
      </div>
      {label && (
        <p className="m-0 text-xs text-[var(--color-fg-muted)]">{t(label.descriptionKey)}</p>
      )}
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">{t('announcement.event.onceNote')}</p>
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
  // 週期依租戶時區計算：預覽回來之後以租戶時區的今天為準；之前（或預覽失敗）退回偏好時區的今天
  const tenantToday = preview.data ? todayInZone(preview.data.timeZone) : today;

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
            min={value.startsOn || tenantToday}
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

import { Select } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { WebhookEventList } from '@/shared/api-sdk';

import { WEBHOOK_EVENT_LABEL } from '../constants';

interface WebhookEventSelectProps {
  /** 可訂閱的事件（`GET /webhooks/events`）；還沒載入時是 undefined。 */
  events: WebhookEventList['items'] | undefined;
  value: string[];
  onValueChange: (value: string[]) => void;
  invalid?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
}

/**
 * 訂閱的事件（docs/architecture/backend/17-webhook.md §9.2 D2）。已訂閱、但目前不在清單上的事件（所屬 feature 被關掉）照樣留著：
 * 存的是名稱，feature 打開之後就會送。
 */
export function WebhookEventSelect({
  events,
  value,
  onValueChange,
  invalid,
  ...rest
}: WebhookEventSelectProps) {
  const { t } = useTranslation();
  const types = [...new Set([...(events ?? []).map((event) => event.type), ...value])];
  const options = types.map((type) => {
    const label = WEBHOOK_EVENT_LABEL[type];
    return {
      value: type,
      label: label ? t(label.nameKey) : type,
      textValue: label ? `${t(label.nameKey)} ${type}` : type,
      description: label ? `${type}｜${t(label.descriptionKey)}` : undefined,
    };
  });

  return (
    <Select
      multiple
      options={options}
      value={value}
      onValueChange={onValueChange}
      valueOrder="options"
      placeholder={t('webhook.field.eventsPlaceholder')}
      loading={!events}
      invalid={invalid}
      itemSize={48}
      {...rest}
    />
  );
}

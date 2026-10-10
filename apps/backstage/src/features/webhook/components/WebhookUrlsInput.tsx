import { Button, IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Input } from '@b2b-system/ui/Input';
import { useTranslation } from '@b2b-system/web-core/locales';

import { WEBHOOK_URL_MAX_LENGTH } from '../constants';

interface WebhookUrlsInputProps {
  /** 每一列一個網址；至少一列（可以是空字串，送出前由呼叫端去掉空白列）。 */
  value: string[];
  onValueChange: (value: string[]) => void;
  /** 最多幾列（`useWebhookUrlCapacity`）；undefined = 還不知道，不顯示「新增網址」。 */
  maxUrls: number | undefined;
  'data-testid'?: string;
}

/**
 * 目標網址的清單（docs/architecture/backend/17-webhook.md §10.2 D13）：一個訂閱 1～10 個、不超過平台給租戶的額度，
 * 同一組事件與密鑰送到每個網址。只剩一列時不能移除；額度用完時沒有「新增網址」。
 */
export function WebhookUrlsInput({
  value,
  onValueChange,
  maxUrls,
  'data-testid': testId,
}: WebhookUrlsInputProps) {
  const { t } = useTranslation();
  const change = (index: number, url: string) =>
    onValueChange(value.map((item, at) => (at === index ? url : item)));
  const remove = (index: number) => onValueChange(value.filter((_, at) => at !== index));

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      {value.map((url, index) => (
        // 列沒有穩定的 id；以位置當 key，移除時其後的輸入框重新對應，內容由 value 決定所以不會錯位
        // oxlint-disable-next-line react/no-array-index-key -- 見上一行
        <div key={index} className="flex items-center gap-2">
          <Input
            className="flex-1"
            type="url"
            value={url}
            maxLength={WEBHOOK_URL_MAX_LENGTH}
            placeholder="https://"
            onChange={(event) => change(index, event.target.value)}
            aria-label={t('webhook.field.urlNumber', { number: index + 1 })}
            data-testid="webhook-url-input"
            data-value={index}
          />
          {value.length > 1 && (
            <IconButton
              size="sm"
              aria-label={t('webhook.field.removeUrl', { number: index + 1 })}
              onClick={() => remove(index)}
              data-testid="webhook-url-remove"
              data-value={index}
            >
              <Icon name="close" size={16} />
            </IconButton>
          )}
        </div>
      ))}
      {maxUrls !== undefined && value.length < maxUrls && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onValueChange([...value, ''])}
            data-testid="webhook-url-add"
          >
            <Icon name="plus" size={16} />
            {t('webhook.field.addUrl')}
          </Button>
        </div>
      )}
    </div>
  );
}

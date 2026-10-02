import { Text } from '@/components/Typography';
import { useTranslation } from '@/core/locales';

interface WebhookSecretNoticeProps {
  secret: string;
}

/**
 * 剛建立或輪替的簽章密鑰（docs/adr/0030-webhooks.md D14）：**只顯示這一次**，關掉之後再也看不到。
 * 一併說明簽章怎麼驗，接收端照著做就能拒絕偽造與重放的請求。
 */
export function WebhookSecretNotice({ secret }: WebhookSecretNoticeProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3" data-testid="webhook-secret-notice">
      {/* role="alert"：報讀器立即念出「只會顯示這一次」 */}
      <p role="alert" className="m-0 text-sm text-[var(--color-warning-text)]">
        {t('webhook.secret.warning')}
      </p>
      <Text
        code
        className="break-all"
        copyable={{ text: secret }}
        data-testid="webhook-secret-value"
      >
        {secret}
      </Text>
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">{t('webhook.secret.verifyHint')}</p>
    </div>
  );
}

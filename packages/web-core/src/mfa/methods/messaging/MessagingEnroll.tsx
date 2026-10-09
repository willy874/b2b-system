import { Button } from '@b2b-system/ui/Button';
import { FormError } from '@b2b-system/ui/FormError';
import { Skeleton } from '@b2b-system/ui/Skeleton';

import { useTranslation } from '../../../locales';
import type { MfaEnrollProps } from '../../registry';
import { SentCodeEnrollForm } from '../shared/SentCodeEnrollForm';
import { useQrCode } from '../shared/useQrCode';

interface LinkData {
  linkUrl: string;
  addFriendUrl?: string;
  code: string;
  botName: string;
}

function linkDataOf(publicData: Record<string, unknown>): LinkData | undefined {
  const { linkUrl, addFriendUrl, code, botName } = publicData;
  if (typeof linkUrl !== 'string' || typeof code !== 'string' || typeof botName !== 'string') {
    return undefined;
  }
  return {
    linkUrl,
    code,
    botName,
    ...(typeof addFriendUrl === 'string' && { addFriendUrl }),
  };
}

export interface MessagingEnrollProps extends MfaEnrollProps {
  /** `mfa.telegram`、`mfa.line`。 */
  textPrefix: string;
  /** `mfa-telegram`、`mfa-line`。 */
  testIdPrefix: string;
}

/**
 * 通訊軟體的設定（docs/architecture/backend/21-mfa.md §9.5）：
 * 1. 以手機掃 QR code（或點連結）開啟 App，把綁定碼傳給 Bot（LINE 要先加入好友）。
 * 2. 回到這裡按「傳送驗證碼」：還沒綁定時伺服器回 `MFA_CHANNEL_NOT_LINKED`。
 * 3. 輸入 Bot 傳來的 6 位數。
 */
export function MessagingEnroll({
  enrollment,
  challenge,
  onResend,
  requesting,
  textPrefix,
  testIdPrefix,
  ...props
}: MessagingEnrollProps) {
  const { t } = useTranslation();
  const link = linkDataOf(enrollment.publicData);
  const qr = useQrCode(link?.linkUrl, 180);

  if (challenge) {
    return (
      <SentCodeEnrollForm
        {...props}
        challenge={challenge}
        onResend={onResend}
        requesting={requesting}
        address={challenge.hint ?? link?.botName ?? ''}
        textPrefix={textPrefix}
        testIdPrefix={testIdPrefix}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid={`${testIdPrefix}-link`}>
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-sm">
        {link?.addFriendUrl && (
          <li>
            {t(`${textPrefix}.addFriend`, { bot: link.botName })}{' '}
            <a href={link.addFriendUrl} target="_blank" rel="noreferrer">
              {t(`${textPrefix}.addFriendLink`)}
            </a>
          </li>
        )}
        <li>{t(`${textPrefix}.sendLinkCode`, { bot: link?.botName ?? '' })}</li>
        <li>{t(`${textPrefix}.thenRequest`)}</li>
      </ol>
      <div className="flex justify-center">
        {qr ? (
          <img
            src={qr}
            alt={t('mfa.messaging.qrAlt')}
            width={180}
            height={180}
            data-testid={`${testIdPrefix}-qr`}
          />
        ) : (
          <Skeleton width={180} height={180} />
        )}
      </div>
      {link && (
        <>
          <Button
            block
            onClick={() => globalThis.open(link.linkUrl, '_blank', 'noopener,noreferrer')}
            data-testid={`${testIdPrefix}-open`}
          >
            {t(`${textPrefix}.open`)}
          </Button>
          <p className="m-0 text-xs text-[var(--color-fg-muted)]">
            {t('mfa.messaging.manual')}{' '}
            <code
              className="select-all"
              data-testid={`${testIdPrefix}-link-code`}
              data-value={link.code}
            >
              {link.code}
            </code>
          </p>
        </>
      )}
      <FormError code={props.error?.code} data-testid="mfa-error">
        {props.error?.message}
      </FormError>
      <Button
        variant="primary"
        block
        loading={requesting}
        onClick={onResend}
        disabled={!onResend}
        data-testid={`${testIdPrefix}-request`}
      >
        {t('mfa.messaging.linked')}
      </Button>
    </div>
  );
}

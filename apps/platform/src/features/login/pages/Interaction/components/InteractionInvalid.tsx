import { useTranslation } from '@b2b-system/web-core/locales';

import { AuthShell } from '../../AuthShell';
import { RestartLogin } from '../../RestartLogin';

interface InteractionInvalidProps {
  /** 互動屬於哪個租戶（已知時直接回到那個租戶的登入） */
  tenant?: string;
  /** 平台管理者的互動 */
  platform?: boolean;
}

/** 互動已經找不到或過期：說明並給「重新開始登入」，不讓使用者停在沒有出口的頁面。 */
export function InteractionInvalid({ tenant, platform }: InteractionInvalidProps) {
  const { t } = useTranslation();
  return (
    <AuthShell title={t('login.title')}>
      <div className="flex flex-col gap-3">
        <p
          className="m-0 text-sm text-[var(--color-danger-text)]"
          data-testid="interaction-invalid"
        >
          {t('error.AUTH_SSO_INTERACTION_INVALID')}
        </p>
        <RestartLogin tenant={tenant} platform={platform} />
      </div>
    </AuthShell>
  );
}

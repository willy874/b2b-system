import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Skeleton } from '@b2b-system/ui/Skeleton';

import { useTranslation } from '../../locales';
import type { MfaAccountStatus } from '../types';
import { FactorList } from './FactorList';

export interface MfaAccountStatusSectionProps {
  status: MfaAccountStatus | undefined;
  /** 有重設的權限時才給；沒有時不顯示按鈕。 */
  onReset?: () => Promise<unknown>;
  resetting?: boolean;
}

/**
 * 管理員看別人的驗證方式（使用者詳情、平台管理者詳情；docs/architecture/backend/21-mfa.md §8）：
 * 方式、名稱、設定與最後使用時間；重設會刪除全部並結束對方所有的 session。
 */
export function MfaAccountStatusSection({
  status,
  onReset,
  resetting,
}: MfaAccountStatusSectionProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const reset = () =>
    confirm({
      title: t('mfa.admin.resetTitle'),
      description: t('mfa.admin.resetDescription'),
      confirmLabel: t('mfa.admin.reset'),
      tone: 'danger',
      onConfirm: onReset,
      'data-testid': 'mfa-reset-confirm',
    });
  return (
    <section className="flex flex-col gap-3" data-testid="mfa-account-status">
      <header className="flex items-center gap-2">
        <h2 className="m-0 text-base font-medium">{t('mfa.admin.title')}</h2>
        {status && (
          <Chip
            tone={status.enabled ? 'success' : 'neutral'}
            data-testid="mfa-status"
            data-value={String(status.enabled)}
          >
            {status.enabled ? t('mfa.self.enabled') : t('mfa.self.disabled')}
          </Chip>
        )}
      </header>
      {status ? (
        <>
          <FactorList
            factors={status.factors}
            empty={
              <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('mfa.admin.none')}</p>
            }
          />
          {status.enabled && (
            <p
              className="m-0 text-sm"
              data-testid="mfa-recovery-remaining"
              data-value={status.recoveryCodesRemaining}
            >
              {t('mfa.self.recoveryRemaining', { count: status.recoveryCodesRemaining })}
            </p>
          )}
        </>
      ) : (
        <Skeleton height={56} />
      )}
      {onReset && status?.enabled && (
        <div>
          <Button
            variant="danger"
            loading={resetting}
            onClick={() => void reset()}
            data-testid="mfa-reset"
          >
            {t('mfa.admin.reset')}
          </Button>
        </div>
      )}
    </section>
  );
}

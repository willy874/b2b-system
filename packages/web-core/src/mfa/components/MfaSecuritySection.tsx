import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { useState } from 'react';

import { QueryError } from '../../components/QueryError';
import { useTranslation } from '../../locales';
import { useToast } from '../../notify';
import type { MfaChallengeInfo, MfaEnrollment, MfaOverview, MfaSubmission } from '../types';
import { FactorActionButton, FactorList } from './FactorList';
import { MfaEnrollFlow } from './MfaEnrollFlow';
import { PasswordConfirmDialog } from './PasswordConfirmDialog';
import { RecoveryCodesDialog } from './RecoveryCodesDialog';

/** 自助端點（backstage：`/auth/mfa`；apps/platform：`/platform/auth/mfa`），由 app 的 `apis/` 提供。 */
export interface MfaSelfApi {
  overviewKey: QueryKey;
  fetchOverview: (signal: AbortSignal) => Promise<MfaOverview>;
  start: (methodId: string) => Promise<MfaEnrollment>;
  resend: (factorId: string) => Promise<MfaChallengeInfo>;
  confirm: (
    factorId: string,
    submission: MfaSubmission,
  ) => Promise<{ recoveryCodes: string[] | null }>;
  remove: (factorId: string, password: string) => Promise<unknown>;
  regenerate: (password: string) => Promise<{ recoveryCodes: string[] }>;
}

export interface MfaSecuritySectionProps {
  api: MfaSelfApi;
  /** 帳號的 email（備用碼檔名）。 */
  account: string;
}

/**
 * 帳號設定頁的「安全性」：已設定的驗證方式、新增、移除、備用碼（docs/architecture/backend/21-mfa.md §7）。
 * 兩個 app 共用；打哪個端點由 `api` 決定。
 */
export function MfaSecuritySection({ api, account }: MfaSecuritySectionProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: api.overviewKey,
    queryFn: ({ signal }) => api.fetchOverview(signal),
  });
  const [enrolling, setEnrolling] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [regenerating, setRegenerating] = useState(false);
  const [newCodes, setNewCodes] = useState<string[]>();

  const refresh = () => queryClient.invalidateQueries({ queryKey: api.overviewKey });

  if (overview.isError)
    return <QueryError error={overview.error} onRetry={() => void overview.refetch()} />;
  const data = overview.data;
  const addable =
    data?.methods.filter((method) => method.enrolled < method.maxFactorsPerAccount) ?? [];

  return (
    <section className="flex flex-col gap-3" data-testid="mfa-security">
      <header className="flex items-center gap-2">
        <h2 className="m-0 text-base font-medium">{t('mfa.self.title')}</h2>
        {data && (
          <Chip
            tone={data.factors.length > 0 ? 'success' : 'neutral'}
            data-testid="mfa-status"
            data-value={String(data.factors.length > 0)}
          >
            {data.factors.length > 0 ? t('mfa.self.enabled') : t('mfa.self.disabled')}
          </Chip>
        )}
        {data?.required && <Chip tone="warning">{t('mfa.self.required')}</Chip>}
      </header>
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('mfa.self.description')}</p>

      {data ? (
        <FactorList
          factors={data.factors}
          empty={
            <p className="m-0 text-sm" data-testid="mfa-no-factors">
              {t('mfa.self.noFactors')}
            </p>
          }
          renderAction={(factor) => (
            <FactorActionButton
              onClick={() => setRemoving(factor.id)}
              data-testid="mfa-factor-remove"
            >
              {t('mfa.self.remove')}
            </FactorActionButton>
          )}
        />
      ) : (
        <Skeleton height={56} />
      )}

      {data && data.factors.length > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <span data-testid="mfa-recovery-remaining" data-value={data.recoveryCodesRemaining}>
            {t('mfa.self.recoveryRemaining', { count: data.recoveryCodesRemaining })}
          </span>
          <Button
            size="sm"
            onClick={() => setRegenerating(true)}
            data-testid="mfa-recovery-regenerate"
          >
            {t('mfa.self.regenerate')}
          </Button>
        </div>
      )}

      <div>
        <Button
          variant="primary"
          disabled={!data || addable.length === 0}
          onClick={() => setEnrolling(true)}
          data-testid="mfa-add"
        >
          {t('mfa.self.add')}
        </Button>
      </div>

      <Dialog
        open={enrolling}
        onOpenChange={setEnrolling}
        title={t('mfa.self.addTitle')}
        dismissible={false}
        data-testid="mfa-add-dialog"
      >
        {enrolling && (
          <MfaEnrollFlow
            methods={addable}
            account={account}
            start={api.start}
            resend={api.resend}
            confirm={api.confirm}
            onCancel={() => setEnrolling(false)}
            onDone={() => {
              setEnrolling(false);
              toast.success(t('mfa.self.added'));
              void refresh();
            }}
          />
        )}
      </Dialog>

      <PasswordConfirmDialog
        open={removing !== undefined}
        title={t('mfa.self.removeTitle')}
        description={
          data?.required && data.factors.length === 1
            ? t('mfa.self.removeLastRequired')
            : t('mfa.self.removeDescription')
        }
        confirmLabel={t('mfa.self.remove')}
        danger
        onClose={() => setRemoving(undefined)}
        onConfirm={async (password) => {
          if (!removing) return;
          await api.remove(removing, password);
          setRemoving(undefined);
          toast.success(t('mfa.self.removed'));
          await refresh();
        }}
        data-testid="mfa-remove-dialog"
      />

      <PasswordConfirmDialog
        open={regenerating}
        title={t('mfa.self.regenerateTitle')}
        description={t('mfa.self.regenerateDescription')}
        confirmLabel={t('mfa.self.regenerate')}
        onClose={() => setRegenerating(false)}
        onConfirm={async (password) => {
          const result = await api.regenerate(password);
          setRegenerating(false);
          setNewCodes(result.recoveryCodes);
          await refresh();
        }}
        data-testid="mfa-regenerate-dialog"
      />

      {newCodes && (
        <RecoveryCodesDialog
          open
          codes={newCodes}
          account={account}
          onDone={() => setNewCodes(undefined)}
        />
      )}
    </section>
  );
}

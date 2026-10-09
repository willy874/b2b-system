import { Button } from '@b2b-system/ui/Button';
import { useTranslation } from '@b2b-system/web-core/locales';
import { MfaChallengeForm, MfaEnrollFlow } from '@b2b-system/web-core/mfa';

import type { MfaStep } from '../../../hooks/useInteractionLogin';
import { useMfaInteraction } from '../../../hooks/useMfaInteraction';

export interface MfaStepPanelProps {
  uid: string;
  step: MfaStep;
  /** 帳號 email（密碼步驟輸入的；備用碼檔名用）。 */
  email: string;
  onRestart: (error?: unknown) => void;
  /** 驗證通過後還要設定新的驗證方式（產品要求，§7.1）：換到設定的步驟。 */
  onNext: (step: MfaStep) => void;
}

/**
 * 密碼通過之後的第二步（docs/architecture/backend/21-mfa.md §4、§11）：驗證既有的因子，或必須啟用而先設定一個。
 * 「改用其他帳號」回到密碼；伺服器上的第二步留到逾時（`MfaPending` 10 分鐘）。
 */
export function MfaStepPanel({ uid, step, email, onRestart, onNext }: MfaStepPanelProps) {
  const { t } = useTranslation();
  const mfa = useMfaInteraction(uid, onRestart, onNext);
  const optional = step.next === 'mfaEnroll' && step.optional;
  return (
    <div className="flex flex-col gap-3" data-testid="login-mfa" data-value={step.next}>
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">
        {step.next === 'mfa'
          ? t('login.mfa.challenge')
          : optional
            ? t('login.mfa.enrollOptional')
            : t('login.mfa.enroll')}
      </p>
      {step.next === 'mfa' ? (
        <MfaChallengeForm
          factors={step.factors}
          recoveryAvailable={step.recoveryAvailable}
          requestChallenge={mfa.requestChallenge}
          verify={mfa.verify}
          onError={mfa.handleError}
        />
      ) : (
        <MfaEnrollFlow
          methods={step.methods}
          account={email}
          start={mfa.startEnrollment}
          resend={mfa.resendEnrollment}
          confirm={mfa.confirmEnrollment}
          onDone={mfa.finishEnrollment}
          recoveryDoneLabel={t('login.mfa.continue')}
          onError={mfa.handleError}
          // 產品要求的設定可以略過（照常完成登入）；政策要求的首次設定不能
          {...(optional && { onCancel: mfa.skipEnrollment, cancelLabel: t('login.mfa.skip') })}
        />
      )}
      <Button variant="ghost" block onClick={() => onRestart()} data-testid="login-mfa-restart">
        {t('login.mfa.restart')}
      </Button>
    </div>
  );
}

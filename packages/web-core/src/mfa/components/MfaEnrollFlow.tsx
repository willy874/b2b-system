import { Button } from '@b2b-system/ui/Button';
import { FormError } from '@b2b-system/ui/FormError';
import { Icon } from '@b2b-system/ui/Icon';
import { useState } from 'react';

import { useTranslation } from '../../locales';
import { useMfaMethodUis } from '../registry';
import type { MfaChallengeInfo, MfaEnrollment, MfaMethodInfo, MfaSubmission } from '../types';
import { RecoveryCodesDialog } from './RecoveryCodesDialog';
import { useMfaFormError } from './useMfaFormError';

export interface MfaEnrollFlowProps {
  /** 可以設定的方式（伺服器回傳：平台開放 ∩ 政策允許）；只有前端登記過的會列出。 */
  methods: readonly MfaMethodInfo[];
  /** 帳號 email（備用碼檔名）。 */
  account: string;
  /** `input`：方式的 `EnrollStart` 收集的資料（簡訊的手機號碼）。 */
  start: (methodId: string, input?: Record<string, unknown>) => Promise<MfaEnrollment>;
  confirm: (
    factorId: string,
    submission: MfaSubmission,
  ) => Promise<{ recoveryCodes: string[] | null }>;
  resend: (factorId: string) => Promise<MfaChallengeInfo>;
  /** 完成（有備用碼時在使用者確認已保存之後）。 */
  onDone: () => void;
  onCancel?: () => void;
  /** 只有一種方式時直接開始，不顯示選擇。 */
  autoStart?: boolean;
  /** 備用碼對話框的完成鈕文字。 */
  recoveryDoneLabel?: string;
  /** 失敗時（例：互動已作廢）交給呼叫端處理；回傳 true 表示已處理，不顯示訊息。 */
  onError?: (error: unknown) => boolean;
  /**
   * 只能在 apps/platform 設定的方式（`enrollAt: 'idp'`，WebAuthn）：backstage 以這個函式改走「重新登入並新增」
   * （docs/architecture/backend/21-mfa.md §7.1）。沒給時照一般流程設定（apps/platform 本身）。
   */
  onEnrollElsewhere?: (method: MfaMethodInfo) => void;
  /** 取消鈕的文字（登入互動中產品要求的設定是「略過」）。 */
  cancelLabel?: string;
}

/**
 * 設定一種驗證方式（docs/architecture/backend/21-mfa.md §7、§4.1 首次設定）：選方式 → 方式的 `Enroll` → 確認 →
 * 第一個因子顯示備用碼。帳號設定頁與登入互動的首次設定共用；呼叫哪個端點由呼叫端決定。
 */
export function MfaEnrollFlow({
  methods,
  account,
  start,
  confirm,
  resend,
  onDone,
  onCancel,
  recoveryDoneLabel,
  onError,
  onEnrollElsewhere,
  cancelLabel,
}: MfaEnrollFlowProps) {
  const { t } = useTranslation();
  const uis = useMfaMethodUis();
  const choices = methods.filter((method) => uis.has(method.id));
  const [enrollment, setEnrollment] = useState<MfaEnrollment>();
  const [challenge, setChallenge] = useState<MfaChallengeInfo | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>();
  const [pending, setPending] = useState(false);
  const [requesting, setRequesting] = useState(false);
  /** 選了需要先填資料的方式（`EnrollStart`），還沒開始設定。 */
  const [preparing, setPreparing] = useState<string>();
  const { error, fail, clear } = useMfaFormError();

  const choose = (method: MfaMethodInfo) => {
    clear();
    if (method.enrollAt === 'idp' && onEnrollElsewhere) {
      onEnrollElsewhere(method);
      return;
    }
    if (uis.get(method.id)?.EnrollStart) {
      setPreparing(method.id);
      return;
    }
    void begin(method.id);
  };

  const handle = (cause: unknown) => {
    if (onError?.(cause)) return;
    fail(cause);
  };

  const begin = async (methodId: string, input?: Record<string, unknown>) => {
    clear();
    setPending(true);
    try {
      const started = await start(methodId, input);
      setPreparing(undefined);
      setEnrollment(started);
      setChallenge(started.challenge);
    } catch (cause) {
      handle(cause);
    } finally {
      setPending(false);
    }
  };

  const submit = async (submission: MfaSubmission) => {
    if (!enrollment) return;
    clear();
    setPending(true);
    try {
      const result = await confirm(enrollment.factorId, {
        ...submission,
        challengeId: submission.challengeId ?? challenge?.challengeId,
      });
      if (result.recoveryCodes?.length) setRecoveryCodes(result.recoveryCodes);
      else onDone();
    } catch (cause) {
      handle(cause);
    } finally {
      setPending(false);
    }
  };

  const resendChallenge = async () => {
    if (!enrollment) return;
    clear();
    setRequesting(true);
    try {
      setChallenge(await resend(enrollment.factorId));
    } catch (cause) {
      handle(cause);
    } finally {
      setRequesting(false);
    }
  };

  if (recoveryCodes) {
    return (
      <RecoveryCodesDialog
        open
        codes={recoveryCodes}
        account={account}
        doneLabel={recoveryDoneLabel}
        onDone={() => {
          setRecoveryCodes(undefined);
          onDone();
        }}
      />
    );
  }

  const ui = enrollment && uis.get(enrollment.method);
  if (enrollment && ui) {
    const { Enroll } = ui;
    const serverChallenge =
      methods.find((method) => method.id === enrollment.method)?.challenge === 'server';
    return (
      <div className="flex flex-col gap-3" data-testid="mfa-enroll" data-value={enrollment.method}>
        <Enroll
          enrollment={enrollment}
          challenge={challenge}
          onSubmit={(submission) => void submit(submission)}
          onResend={serverChallenge || challenge ? () => void resendChallenge() : undefined}
          requesting={requesting}
          pending={pending}
          error={error}
        />
        <Button
          variant="ghost"
          onClick={() => setEnrollment(undefined)}
          data-testid="mfa-enroll-back"
        >
          {t('mfa.enroll.back')}
        </Button>
      </div>
    );
  }

  const prepareUi = preparing ? uis.get(preparing) : undefined;
  if (preparing && prepareUi?.EnrollStart) {
    const { EnrollStart } = prepareUi;
    return (
      <div className="flex flex-col gap-3" data-testid="mfa-enroll-start" data-value={preparing}>
        <EnrollStart
          onStart={(input) => void begin(preparing, input)}
          pending={pending}
          error={error}
        />
        <Button
          variant="ghost"
          onClick={() => setPreparing(undefined)}
          data-testid="mfa-enroll-back"
        >
          {t('mfa.enroll.back')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="mfa-enroll-choose">
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('mfa.enroll.choose')}</p>
      {choices.map((method) => {
        const methodUi = uis.get(method.id);
        if (!methodUi) return null;
        return (
          <Button
            key={method.id}
            block
            disabled={pending}
            onClick={() => choose(method)}
            startIcon={<Icon name={methodUi.icon} size={16} />}
            // 名稱與說明兩到三行：按鈕的固定高度與不換行會讓窄的登入卡片裡的說明溢出
            className="h-auto justify-start whitespace-normal py-2 text-left"
            data-testid="mfa-enroll-method"
            data-value={method.id}
          >
            <span className="flex min-w-0 flex-col items-start gap-0.5 leading-snug">
              <span>{t(methodUi.labelKey)}</span>
              <span className="text-xs text-[var(--color-fg-muted)]">
                {t(methodUi.descriptionKey)}
              </span>
              {method.enrollAt === 'idp' && onEnrollElsewhere && (
                <span className="text-xs text-[var(--color-fg-muted)]">
                  {t('mfa.enroll.elsewhere')}
                </span>
              )}
            </span>
          </Button>
        );
      })}
      {choices.length === 0 && (
        <p className="m-0 text-sm" data-testid="mfa-enroll-none">
          {t('mfa.enroll.noMethods')}
        </p>
      )}
      <FormError code={error?.code} data-testid="mfa-enroll-error">
        {error?.message}
      </FormError>
      {onCancel && (
        <Button variant="ghost" onClick={onCancel} data-testid="mfa-enroll-cancel">
          {cancelLabel ?? t('common.cancel')}
        </Button>
      )}
    </div>
  );
}

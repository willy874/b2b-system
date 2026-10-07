import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { RadioGroup } from '@b2b-system/ui/Radio';
import { useEffect, useRef, useState } from 'react';

import { useTranslation } from '../../locales';
import { useMfaMethodUis } from '../registry';
import { MFA_RECOVERY_FACTOR } from '../types';
import type { MfaChallengeInfo, MfaFactorView, MfaSubmission } from '../types';
import { useMfaFormError } from './useMfaFormError';

export interface MfaChallengeFormProps {
  /** 可以用的因子（伺服器已濾掉被關掉的方式）。 */
  factors: readonly MfaFactorView[];
  recoveryAvailable: boolean;
  requestChallenge: (factorId: string) => Promise<MfaChallengeInfo>;
  /** 驗證；成功時呼叫端負責跳轉。 */
  verify: (factorId: string, submission: MfaSubmission) => Promise<void>;
  /** 第二步作廢等要呼叫端處理的錯誤；回傳 true 表示已處理。 */
  onError?: (error: unknown) => boolean;
}

/**
 * 登入的第二步（docs/architecture/backend/21-mfa.md §4、§11）：選因子 → 方式的 `Challenge` → 驗證；
 * 也可以改用備用碼。方式的 UI 沒有登記的因子不列出（這個版本不支援）。
 */
export function MfaChallengeForm({
  factors,
  recoveryAvailable,
  requestChallenge,
  verify,
  onError,
}: MfaChallengeFormProps) {
  const { t } = useTranslation();
  const uis = useMfaMethodUis();
  const usable = factors.filter((factor) => uis.has(factor.method));
  const [selected, setSelected] = useState<string | undefined>(usable[0]?.id);
  const [useRecovery, setUseRecovery] = useState(usable.length === 0);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [challenges, setChallenges] = useState<Record<string, MfaChallengeInfo>>({});
  const [pending, setPending] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const { error, fail, clear } = useMfaFormError();
  // 切到備用碼時把游標放進輸入框（不用 autoFocus：jsx-a11y）
  const recoveryRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (useRecovery) recoveryRef.current?.focus();
  }, [useRecovery]);

  const handle = (cause: unknown) => {
    if (onError?.(cause)) return;
    fail(cause);
  };

  const submit = async (factorId: string, submission: MfaSubmission) => {
    clear();
    setPending(true);
    try {
      await verify(factorId, submission);
    } catch (cause) {
      handle(cause);
      setPending(false);
    }
  };

  const request = async (factorId: string) => {
    clear();
    setRequesting(true);
    try {
      const challenge = await requestChallenge(factorId);
      setChallenges((current) => ({ ...current, [factorId]: challenge }));
    } catch (cause) {
      handle(cause);
    } finally {
      setRequesting(false);
    }
  };

  const factor = usable.find((candidate) => candidate.id === selected);
  const ui = factor && uis.get(factor.method);

  if (useRecovery) {
    return (
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(MFA_RECOVERY_FACTOR, { payload: { code: recoveryCode } });
        }}
        data-testid="mfa-recovery-form"
      >
        <Field
          label={t('mfa.challenge.recoveryCode')}
          description={t('mfa.challenge.recoveryHint')}
        >
          <Input
            value={recoveryCode}
            autoComplete="off"
            ref={recoveryRef}
            className="font-mono"
            onChange={(event) => setRecoveryCode(event.target.value)}
            data-testid="mfa-recovery-input"
          />
        </Field>
        <FormError code={error?.code} data-testid="mfa-error">
          {error?.message}
        </FormError>
        <Button
          type="submit"
          variant="primary"
          block
          loading={pending}
          disabled={!recoveryCode.trim()}
          data-testid="mfa-recovery-submit"
        >
          {t('mfa.challenge.verify')}
        </Button>
        {usable.length > 0 && (
          <Button
            variant="ghost"
            block
            onClick={() => setUseRecovery(false)}
            data-testid="mfa-use-factor"
          >
            {t('mfa.challenge.useFactor')}
          </Button>
        )}
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="mfa-challenge">
      {usable.length > 1 && (
        <RadioGroup
          value={selected}
          onValueChange={(value) => {
            clear();
            setSelected(value);
          }}
          aria-label={t('mfa.challenge.chooseFactor')}
          options={usable.map((candidate) => {
            const methodUi = uis.get(candidate.method);
            return {
              value: candidate.id,
              label: methodUi ? t(methodUi.labelKey) : candidate.method,
              description:
                [candidate.label, candidate.hint].filter(Boolean).join(' · ') || undefined,
            };
          })}
          data-testid="mfa-factor-choice"
        />
      )}
      {factor && ui && (
        <ui.Challenge
          key={factor.id}
          factor={factor}
          challenge={challenges[factor.id] ?? null}
          onRequestChallenge={() => void request(factor.id)}
          requesting={requesting}
          onSubmit={(submission) =>
            void submit(factor.id, {
              ...submission,
              challengeId: submission.challengeId ?? challenges[factor.id]?.challengeId,
            })
          }
          pending={pending}
          error={error}
        />
      )}
      {recoveryAvailable && (
        <Button
          variant="ghost"
          block
          onClick={() => setUseRecovery(true)}
          data-testid="mfa-use-recovery"
        >
          {t('mfa.challenge.useRecovery')}
        </Button>
      )}
    </div>
  );
}

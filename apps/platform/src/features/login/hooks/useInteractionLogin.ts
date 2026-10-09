import {
  ErrorCodes,
  getErrorMessageKey,
  isAppError,
  useErrorMessage,
} from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useCountdown, zodFormValidator } from '@b2b-system/web-shared/hooks';
import { useForm } from '@tanstack/react-form';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import type { SsoMfaChallengeNext, SsoMfaEnrollNext } from '@/shared/api-sdk';

import { useAccountPolicy } from './useAccountPolicy';
import { useRequestedLocale } from './useRequestedLocale';
import {
  useSsoDiscovery,
  useSsoInteraction,
  useSsoInteractionAbortMutation,
  useSsoInteractionLoginMutation,
  useStartExternalLoginMutation,
} from './useSsoInteraction';

/** 互動過期（登入頁放太久、重複使用）：只能從產品重新開始登入。 */
const INTERACTION_EXPIRED = 'AUTH_SSO_INTERACTION_INVALID';

function isInteractionExpired(error: unknown): boolean {
  return isAppError(error) && error.code === INTERACTION_EXPIRED;
}

const EmailSchema = z.string().trim().min(1).email();

const LoginFormSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
});

/** 密碼通過之後的下一步（伺服器回傳）。 */
export type MfaStep = SsoMfaChallengeNext | SsoMfaEnrollNext;

/** 送出失敗的訊息與錯誤碼（錯誤碼給 E2E 以 `data-value` 斷言，不依語系的文字）。 */
export interface InteractionFormError {
  message: string;
  code?: string;
}

/**
 * IdP 登入互動頁的流程（docs/architecture/04-sso.md §12）：載入互動、帶上產品的語言、以 email 探索外部 IdP（D9）、
 * 密碼登入或改走外部 IdP、取消，以及送出失敗與網址帶回的錯誤（`?error=`）。
 * 互動過期時改給「重新開始登入」（`expired`）。
 */
export function useInteractionLogin(uid: string, searchError: string | undefined) {
  const interaction = useSsoInteraction(uid);
  // 與要求登入的產品用同一個語言（backstage 帶來的 ui_locales）
  useRequestedLocale(interaction.data?.uiLocales);
  const policy = useAccountPolicy(interaction.data?.tenant?.code);
  const login = useSsoInteractionLoginMutation();
  const abort = useSsoInteractionAbortMutation();
  const external = useStartExternalLoginMutation();
  const toMessage = useErrorMessage();
  const { t } = useTranslation();
  const [failure, setFailure] = useState<InteractionFormError & { retryable?: boolean }>();
  // 送出時才發現互動已過期：表單再送也沒用，改給「重新開始登入」
  const [expired, setExpired] = useState(false);
  // 密碼通過、需要 MFA：第二步（docs/architecture/backend/21-mfa.md §4）
  const [mfaStep, setMfaStep] = useState<MfaStep>();
  // 被限流（429）且伺服器給了等待秒數：倒數到可以再試為止，期間停用送出鈕——一直重送只會讓限流持續更久
  const retry = useCountdown();
  const fail = (error: unknown) => {
    // 限流（429）與密碼驗證的名額已滿（503 AUTH_BUSY）都帶建議的等待秒數
    const retryAfter =
      isAppError(error) && (error.code === ErrorCodes.RATE_LIMITED || error.code === 'AUTH_BUSY')
        ? error.retryAfterSeconds
        : undefined;
    setFailure({
      message: toMessage(error),
      code: isAppError(error) ? error.code : undefined,
      retryable: retryAfter !== undefined,
    });
    setExpired(isInteractionExpired(error));
    if (retryAfter !== undefined) retry.start(retryAfter);
  };
  // 限流的訊息跟著倒數更新；數完就收起來，不留一句「請在 0 秒後再試」
  const formError: InteractionFormError | undefined = failure?.retryable
    ? retry.remaining > 0
      ? {
          code: failure.code,
          message:
            failure.code === 'AUTH_BUSY'
              ? failure.message
              : t('error.rate_limited_retry', { count: retry.remaining }),
        }
      : undefined
    : failure && { code: failure.code, message: failure.message };
  // 網址帶來的錯誤只顯示到使用者再試一次為止
  const [showSearchError, setShowSearchError] = useState(true);
  /** 拿去查網域的 email：離開欄位（或送出）時才更新，不在每次輸入時查詢。 */
  const [discoveryEmail, setDiscoveryEmail] = useState<string>();
  const discovery = useSsoDiscovery(uid, discoveryEmail);
  const provider = discovery.data?.provider ?? null;
  const ssoOnly = Boolean(provider && discovery.data?.ssoOnly);

  // 進頁面就把游標放在 Email 欄。欄位在互動載入前就已經顯示，只在掛載時聚焦一次：
  // 等載入完成才聚焦的話，使用者已經移到密碼欄時會被搶回 Email 欄，接著打的密碼以明文進了 Email 欄
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const discover = (email: string) => {
    const parsed = EmailSchema.safeParse(email);
    setDiscoveryEmail(parsed.success ? parsed.data : undefined);
  };

  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: { onSubmit: zodFormValidator(LoginFormSchema) },
    onSubmit: async ({ value }) => {
      setFailure(undefined);
      setShowSearchError(false);
      try {
        const result = await login.mutateAsync({ params: { uid, ...value } });
        if ('next' in result) {
          form.setFieldValue('password', '');
          setMfaStep(result);
        }
      } catch (error) {
        fail(error);
      }
    },
  });

  const startExternal = async () => {
    if (!provider) return;
    setFailure(undefined);
    setShowSearchError(false);
    try {
      await external.mutateAsync({ params: { uid, providerId: provider.id } });
    } catch (error) {
      fail(error);
    }
  };

  return {
    interaction,
    /** 需要 MFA 時的第二步；`restartMfa` 回到密碼（第二步作廢時，帶上原因）。 */
    mfaStep,
    restartMfa: (error?: unknown) => {
      setMfaStep(undefined);
      if (error !== undefined) fail(error);
    },
    /** 第二步通過後還要設定新的驗證方式（產品要求，docs/architecture/backend/21-mfa.md §7.1）。 */
    advanceMfa: setMfaStep,
    policy,
    form,
    emailRef,
    discover,
    provider,
    ssoOnly,
    expired,
    formError,
    /** 被限流時還要等幾秒才能再送出（0 = 可以送出） */
    retryIn: retry.remaining,
    /** 網址帶回、還沒被使用者重試蓋掉的錯誤碼 */
    searchError: showSearchError ? searchError : undefined,
    searchErrorKey: searchError ? getErrorMessageKey(searchError) : undefined,
    /** 已經在跳轉：取消鈕停用 */
    redirecting:
      login.isPending ||
      (login.isSuccess && 'redirectTo' in login.data) ||
      external.isPending ||
      external.isSuccess,
    loggingIn: login.isPending || (login.isSuccess && 'redirectTo' in login.data),
    externalPending: external.isPending,
    externalStarting: external.isPending || external.isSuccess,
    loginPending: login.isPending,
    cancelling: abort.isPending,
    startExternal,
    cancel: () => abort.mutate({ params: { uid } }),
  };
}

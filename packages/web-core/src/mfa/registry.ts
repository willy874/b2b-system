import type { IconName } from '@b2b-system/ui/Icon';
import { useStore } from '@b2b-system/web-shared/hooks';
import { createRegistry } from '@b2b-system/web-shared/registry';
import type { ComponentType } from 'react';

import type { MfaChallengeInfo, MfaEnrollment, MfaFactorView, MfaSubmission } from './types';

/** 送出失敗的訊息（錯誤碼給 E2E 以 `data-value` 斷言）。 */
export interface MfaFormError {
  message: string;
  code?: string;
}

/** 方式的「設定」元件：顯示伺服器給的資料（TOTP 的 QR code），組出確認的 payload。 */
export interface MfaEnrollProps {
  enrollment: MfaEnrollment;
  /** 目前的 challenge（Email：開始設定時寄出的那封；重寄後換新的）。 */
  challenge: MfaChallengeInfo | null;
  onSubmit: (submission: MfaSubmission) => void;
  /** `challenge = 'server'` 的方式才有：請伺服器發出（`enrollChallenge: 'onRequest'` 的第一次）或重寄。 */
  onResend?: () => void;
  /** 正在請求 challenge。 */
  requesting?: boolean;
  pending: boolean;
  error?: MfaFormError;
}

/** 方式的「開始設定前」元件：收集設定要的資料（簡訊的手機號碼），交給 `onStart`。 */
export interface MfaEnrollStartProps {
  onStart: (input: Record<string, unknown>) => void;
  pending: boolean;
  error?: MfaFormError;
}

/** 方式的「驗證」元件（登入的第二步）：輸入碼，組出 payload。 */
export interface MfaChallengeProps {
  factor: MfaFactorView;
  /** `challenge = 'server'` 的方式：還沒發出時是 null，元件顯示「寄送驗證碼」。 */
  challenge: MfaChallengeInfo | null;
  onRequestChallenge?: () => void;
  requesting?: boolean;
  onSubmit: (submission: MfaSubmission) => void;
  pending: boolean;
  error?: MfaFormError;
}

/**
 * 一種驗證方式的前端（docs/architecture/backend/21-mfa.md §11）：與 api 的 `MfaMethod` 以 `id` 對應。
 * 兩個 app 在 `app/plugin.ts` 登記內建的方式；伺服器回傳沒有登記的 id 時，該因子顯示「這個版本不支援」。
 */
export interface MfaMethodUi {
  id: string;
  labelKey: string;
  descriptionKey: string;
  icon: IconName;
  /** 開始設定前要使用者先填的資料；沒有 = 選了方式就直接開始。 */
  EnrollStart?: ComponentType<MfaEnrollStartProps>;
  Enroll: ComponentType<MfaEnrollProps>;
  Challenge: ComponentType<MfaChallengeProps>;
}

export const mfaMethodRegistry = createRegistry<string, MfaMethodUi>('MFA method');

/** 在 plugin 的同步階段登記；重複登記丟例外。回傳反註冊函式。 */
export function registerMfaMethod(method: MfaMethodUi): () => void {
  return mfaMethodRegistry.register(method.id, method);
}

/** 讀取一定存在的方式（程式內寫死的 id）；沒有登記是程式錯誤，丟例外。 */
export function requireMfaMethod(id: string): MfaMethodUi {
  const method = mfaMethodRegistry.get(id);
  if (!method) throw new Error(`MFA method not registered: ${id}`);
  return method;
}

/** 伺服器給的 id：沒有登記時回 undefined（顯示「這個版本不支援」，不讓畫面壞掉）。 */
export function useMfaMethodUi(id: string): MfaMethodUi | undefined {
  return useStore(mfaMethodRegistry.store, (state) => state.entries.get(id));
}

export function useMfaMethodUis(): ReadonlyMap<string, MfaMethodUi> {
  return useStore(mfaMethodRegistry.store, (state) => state.entries);
}

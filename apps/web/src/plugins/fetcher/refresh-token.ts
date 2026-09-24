import { sessionStore } from '@/core/auth';
import { raceAbort } from '@/core/client';
import type { ErrorInterceptor } from '@/core/client';
import { AppError, isSessionRejected, SESSION_TERMINAL_CODES } from '@/core/errors';

import { sentAccessToken } from './auth';

/**
 * 401 → 續期 → 重放原請求（重放會重跑請求攔截器，換上新的 token）。
 * 終止類錯誤碼（token 被撤銷、重用偵測…）不重試，直接結束 session。
 */
export const refreshTokenInterceptor: ErrorInterceptor = async (error, request, retry) => {
  if (!(error instanceof AppError)) throw error;

  if (SESSION_TERMINAL_CODES.has(error.code)) {
    sessionStore.endSession(error.code);
    throw error;
  }

  if (error.status !== 401) throw error;

  let token: string | undefined;
  try {
    // 被拒的 token 可能還沒到期：必須強制續期，否則會拿同一個 token 重放
    token = await raceAbort(
      sessionStore.renewAccessToken(sentAccessToken(request)),
      request.signal,
    );
  } catch (renewError) {
    // 續期被伺服器拒絕：SessionStore 已結束 session，對呼叫端回報原本的 401。
    // 其餘（本請求被中止、網路錯誤、5xx、429）不代表 session 有問題：原樣丟出，
    // 交給後面的 retry 攔截器（重試時會再走一次續期）或呼叫端
    if (isSessionRejected(renewError)) throw error;
    throw renewError;
  }
  if (!token) {
    // 沒有 session 可續（未登入，或等待期間 session 已被其他分頁結束）
    sessionStore.endSession(error.code);
    throw error;
  }

  return retry();
};

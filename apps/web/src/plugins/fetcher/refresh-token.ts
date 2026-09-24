import { sessionStore } from '@/core/auth';
import { isRequestAborted, raceAbort } from '@/core/client';
import type { ErrorInterceptor } from '@/core/client';
import { AppError, SESSION_TERMINAL_CODES } from '@/core/errors';

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
    // 本請求被中止不代表 session 有問題
    if (isRequestAborted(renewError)) throw renewError;
    sessionStore.endSession(error.code);
    throw error;
  }
  if (!token) {
    sessionStore.endSession(error.code);
    throw error;
  }

  return retry();
};

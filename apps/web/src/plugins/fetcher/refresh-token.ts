import { sessionStore } from '@/core/auth';
import type { ErrorInterceptor } from '@/core/client';
import { AppError, SESSION_TERMINAL_CODES } from '@/core/errors';

/**
 * 401 → 續期 → 重放原請求。
 * 終止類錯誤碼（token 被撤銷、重用偵測…）不重試，直接結束 session。
 */
export const refreshTokenInterceptor: ErrorInterceptor = async (error, _request, retry) => {
  if (!(error instanceof AppError)) throw error;

  if (SESSION_TERMINAL_CODES.has(error.code)) {
    sessionStore.endSession(error.code);
    throw error;
  }

  if (error.status !== 401) throw error;

  try {
    const token = await sessionStore.ensureAccessToken();
    if (!token) {
      sessionStore.endSession(error.code);
      throw error;
    }
  } catch {
    sessionStore.endSession(error.code);
    throw error;
  }

  return retry();
};

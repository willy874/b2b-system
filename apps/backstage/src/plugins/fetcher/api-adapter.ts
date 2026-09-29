import type { FetcherResponse, ResponseInterceptor } from '@/core/client';
import { AppError } from '@/core/errors';

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
}

/** 後端錯誤信封 → AppError；成功回應剝掉 `{ data }` 外層。 */
export const apiAdapterInterceptor: ResponseInterceptor = async (response) => {
  if (response.status >= 400) {
    const envelope = response.data as ErrorEnvelope | undefined;
    throw new AppError(
      envelope?.error?.code ?? 'INTERNAL_ERROR',
      response.status,
      envelope?.error?.details,
      envelope?.error?.requestId ?? response.headers.get('x-request-id') ?? undefined,
    );
  }
  const body = response.data as { data?: unknown } | undefined;
  const unwrapped = body && typeof body === 'object' && 'data' in body ? body.data : body;
  return { ...response, data: unwrapped } satisfies FetcherResponse;
};

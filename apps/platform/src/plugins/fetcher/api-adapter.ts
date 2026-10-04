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

const TOO_MANY_REQUESTS = 429;

/** `Retry-After`（秒數格式）；後端的 details 沒帶時的後備（例：前面的代理回的 429）。 */
function retryAfterOf(headers: Headers): number | undefined {
  const seconds = Number(headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function detailsOf(response: FetcherResponse, envelope: ErrorEnvelope | undefined) {
  const details = envelope?.error?.details;
  if (response.status !== TOO_MANY_REQUESTS || details?.retryAfterSeconds !== undefined) {
    return details;
  }
  const retryAfterSeconds = retryAfterOf(response.headers);
  return retryAfterSeconds === undefined ? details : { ...details, retryAfterSeconds };
}

/** 後端錯誤信封 → AppError；成功回應剝掉 `{ data }` 外層。 */
export const apiAdapterInterceptor: ResponseInterceptor = async (response) => {
  if (response.status >= 400) {
    const envelope = response.data as ErrorEnvelope | undefined;
    throw new AppError(
      envelope?.error?.code ?? 'INTERNAL_ERROR',
      response.status,
      detailsOf(response, envelope),
      envelope?.error?.requestId ?? response.headers.get('x-request-id') ?? undefined,
    );
  }
  const body = response.data as { data?: unknown } | undefined;
  const unwrapped = body && typeof body === 'object' && 'data' in body ? body.data : body;
  return { ...response, data: unwrapped } satisfies FetcherResponse;
};

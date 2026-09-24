export interface HttpRequestDTO<TParams = unknown> {
  params: TParams;
  /**
   * 呼叫端的取消訊號。TanStack Query 的 `queryFn` 會給；mutation 需要可取消時自行傳入。
   * 由 `defineXxxFetcher` 自動接到 `HttpContext`，fetcher 實作不必（也不應）自己傳給 `fetch`。
   */
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface FetcherRequest {
  url: string;
  init: RequestInit;
  /** 這次請求自己的 signal（合併了呼叫端、逾時與 `abortRequests()`）。攔截器的等待都要尊重它。 */
  signal: AbortSignal;
}

export interface FetcherResponse<T = unknown> {
  status: number;
  data: T;
  headers: Headers;
}

export type RequestInterceptor = (request: FetcherRequest) => Promise<FetcherRequest>;
export type ResponseInterceptor = (
  response: FetcherResponse,
  request: FetcherRequest,
) => Promise<FetcherResponse>;
/**
 * `retry` 會從原始請求重跑一次請求攔截器再送出（例如續期後換上新的 Authorization）。
 * `request` 是最後一次實際送出的請求。
 */
export type ErrorInterceptor = (
  error: unknown,
  request: FetcherRequest,
  retry: () => Promise<FetcherResponse>,
) => Promise<FetcherResponse>;

export interface HttpContextOptions {
  name: string;
  baseUrl: string;
  /** 整個請求（含續期等待與重試）的上限；省略代表不設逾時。 */
  timeoutMs?: number;
  requestInterceptors?: RequestInterceptor[];
  responseInterceptors?: ResponseInterceptor[];
  errorInterceptors?: ErrorInterceptor[];
}

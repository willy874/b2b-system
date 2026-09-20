export interface HttpRequestDTO<TParams = unknown> {
  params: TParams;
  /** TanStack Query 會傳入，必須一路傳到 fetch，否則舊回應會覆蓋新回應。 */
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface FetcherRequest {
  url: string;
  init: RequestInit;
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
export type ErrorInterceptor = (
  error: unknown,
  request: FetcherRequest,
  retry: () => Promise<FetcherResponse>,
) => Promise<FetcherResponse>;

export interface HttpContextOptions {
  name: string;
  baseUrl: string;
  requestInterceptors?: RequestInterceptor[];
  responseInterceptors?: ResponseInterceptor[];
  errorInterceptors?: ErrorInterceptor[];
}

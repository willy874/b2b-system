import type { FetcherRequest, FetcherResponse, HttpContextOptions } from './types';

/**
 * 一個具名的 HTTP 管道：baseUrl ＋ 攔截器鏈。
 * `base` 給 login / refresh / health；`auth` 給其餘全部。
 */
export class HttpContext {
  constructor(private readonly options: HttpContextOptions) {}

  get name(): string {
    return this.options.name;
  }

  async request<T>(url: string, init: RequestInit = {}): Promise<FetcherResponse<T>> {
    let request: FetcherRequest = {
      url: url.startsWith('http') ? url : `${this.options.baseUrl}${url}`,
      init,
    };

    const execute = async (): Promise<FetcherResponse> => {
      const response = await fetch(request.url, request.init);
      const text = await response.text();
      const data: unknown = text.length ? JSON.parse(text) : undefined;
      let result: FetcherResponse = { status: response.status, data, headers: response.headers };
      for (const interceptor of this.options.responseInterceptors ?? []) {
        result = await interceptor(result, request);
      }
      return result;
    };

    try {
      // 請求攔截器也放在 try 裡：`ensureAccessToken()` 失敗時錯誤攔截器才看得到
      for (const interceptor of this.options.requestInterceptors ?? []) {
        request = await interceptor(request);
      }
      return (await execute()) as FetcherResponse<T>;
    } catch (error) {
      let lastError = error;
      for (const interceptor of this.options.errorInterceptors ?? []) {
        try {
          return (await interceptor(lastError, request, execute)) as FetcherResponse<T>;
        } catch (next) {
          lastError = next;
        }
      }
      throw lastError;
    }
  }
}

const contexts = new Map<string, HttpContext>();

export function registerHttpContext(context: HttpContext): void {
  contexts.set(context.name, context);
}

export function getHttpContext(name: string): HttpContext {
  const context = contexts.get(name);
  if (!context) throw new Error(`HttpContext "${name}" 尚未註冊`);
  return context;
}

export function resetHttpContexts(): void {
  contexts.clear();
}

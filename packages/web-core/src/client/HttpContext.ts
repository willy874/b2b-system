import { AbortReason, RequestAbortedError, requestAbortBus, toAbortedError } from './abort';
import { NetworkError } from './NetworkError';
import type { FetcherRequest, FetcherResponse, HttpContextOptions } from './types';

/** fetcher 實作拿到的介面：已綁定呼叫端的 signal。 */
export interface HttpClient {
  request<T>(url: string, init?: RequestInit): Promise<FetcherResponse<T>>;
}

/**
 * 一個具名的 HTTP 管道：baseUrl ＋ 攔截器鏈。
 * `base` 給 login / refresh / health；`auth` 給其餘全部。
 */
export class HttpContext implements HttpClient {
  constructor(private readonly options: HttpContextOptions) {}

  get name(): string {
    return this.options.name;
  }

  /** 綁定呼叫端的 signal 與快取模式；`init` 有給時以它為準。 */
  bind(signal: AbortSignal | undefined, cache?: RequestCache): HttpClient {
    return {
      request: <T>(url: string, init: RequestInit = {}) =>
        this.request<T>(url, {
          ...init,
          signal: init.signal ?? signal,
          cache: init.cache ?? cache,
        }),
    };
  }

  async request<T>(url: string, init: RequestInit = {}): Promise<FetcherResponse<T>> {
    const abort = this.createAbortScope(init.signal ?? undefined);
    const { signal } = abort;
    const original: FetcherRequest = {
      url: url.startsWith('http') ? url : `${this.options.baseUrl}${url}`,
      init: { ...init, signal },
      signal,
    };
    let sent = original;

    // 每次送出（含重放）都從原始請求重跑請求攔截器：續期後要換上新的 token
    const send = async (): Promise<FetcherResponse> => {
      let request = original;
      for (const interceptor of this.options.requestInterceptors ?? []) {
        request = await interceptor(request);
      }
      sent = request;
      let result: FetcherResponse;
      try {
        const response = await fetch(request.url, request.init);
        result = {
          status: response.status,
          data: parseBody(await response.text()),
          headers: response.headers,
        };
      } catch (error) {
        // 中止：統一成 RequestAbortedError（舊環境的 fetch 丟 DOMException）；
        // 其餘都是傳輸層失敗（離線、DNS、CORS、連線中途斷掉）
        if (signal.aborted) throw toAbortedError(signal);
        throw new NetworkError(error);
      }
      for (const interceptor of this.options.responseInterceptors ?? []) {
        result = await interceptor(result, request);
      }
      return result;
    };

    try {
      // 請求攔截器也在 try 裡：`ensureAccessToken()` 失敗時錯誤攔截器才看得到
      return (await send()) as FetcherResponse<T>;
    } catch (error) {
      let lastError = error;
      for (const interceptor of this.options.errorInterceptors ?? []) {
        // 已中止就不再續期、重試
        if (signal.aborted) break;
        try {
          return (await interceptor(lastError, sent, send)) as FetcherResponse<T>;
        } catch (next) {
          lastError = next;
        }
      }
      throw lastError;
    } finally {
      abort.dispose();
    }
  }

  /** 合併三個中止來源：呼叫端 signal、逾時、`abortRequests()` 廣播。 */
  private createAbortScope(callerSignal: AbortSignal | undefined) {
    const controller = new AbortController();
    const abortWith = (reason: AbortReason, detail?: string) => {
      if (!controller.signal.aborted) controller.abort(new RequestAbortedError(reason, detail));
    };

    const onCallerAbort = () => abortWith(AbortReason.CALLER);
    if (callerSignal?.aborted) onCallerAbort();
    else callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

    const timer =
      this.options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => abortWith(AbortReason.TIMEOUT), this.options.timeoutMs);

    const offBus = requestAbortBus.on('abort', (event) => {
      if (!event.contexts || event.contexts.includes(this.name)) {
        abortWith(event.reason, event.detail);
      }
    });

    return {
      signal: controller.signal,
      dispose: () => {
        callerSignal?.removeEventListener('abort', onCallerAbort);
        clearTimeout(timer);
        offBus();
      },
    };
  }
}

/** 空字串 → undefined；非 JSON（例如 proxy 回的 502 HTML）→ undefined，交給狀態碼判斷。 */
function parseBody(text: string): unknown {
  if (!text.length) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
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

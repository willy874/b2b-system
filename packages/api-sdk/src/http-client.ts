/**
 * 產生的 endpoint 都走這支 mutator。
 * 真正的傳輸行為（認證標頭、續期、錯誤轉換）由 `apps/web/src/core/client` 注入，
 * SDK 本身不認識任何攔截器。
 */
export interface SdkResponse<TData = unknown> {
  status: number;
  data: TData;
  headers: Headers;
}

export type SdkTransport = <TResponse>(url: string, init: RequestInit) => Promise<TResponse>;

/** 預設實作：直接 fetch，回傳與 orval 產生的型別相同的 `{ status, data, headers }`。 */
const defaultTransport: SdkTransport = async <TResponse>(url: string, init: RequestInit) => {
  const response = await fetch(url, init);
  const text = await response.text();
  const data: unknown = text.length ? JSON.parse(text) : undefined;
  return { status: response.status, data, headers: response.headers } as TResponse;
};

let transport: SdkTransport = defaultTransport;

/** 由宿主應用在啟動時注入實際傳輸實作。 */
export function setSdkTransport(next: SdkTransport): void {
  transport = next;
}

export function resetSdkTransport(): void {
  transport = defaultTransport;
}

export function sdkFetch<TResponse>(url: string, init: RequestInit = {}): Promise<TResponse> {
  return transport<TResponse>(url, init);
}

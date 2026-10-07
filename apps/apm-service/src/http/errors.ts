/**
 * 回給客戶端的錯誤。格式與 Sentry 相同：`{ "detail": "…" }`。
 * SDK 只看狀態碼（429 另看 `Retry-After`、`X-Sentry-Rate-Limits`），`detail` 給人看。
 */
export class ApmError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(detail);
    this.name = 'ApmError';
  }
}

export function isApmError(error: unknown): error is ApmError {
  return error instanceof ApmError;
}

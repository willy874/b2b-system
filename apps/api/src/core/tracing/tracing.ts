import { ProxyTracerProvider, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Attributes, Span } from '@opentelemetry/api';

/**
 * 程式內手動開的 span（docs/architecture/08-monitoring.md §3）。沒有載入 tracing（`OTEL_EXPORTER_OTLP_ENDPOINT` 沒設）時
 * `@opentelemetry/api` 是空操作，這裡的呼叫幾乎沒有成本。
 */
export const tracer = trace.getTracer('b2b-system-api');

/** span 上的租戶屬性：Tempo 以 `{ span.b2b.tenant = "acme" }` 找某個租戶的 trace（指標不帶租戶，§2.3）。 */
export const TENANT_ATTRIBUTE = 'b2b.tenant';

/** 在目前的 span 標上租戶代碼（HTTP 請求、WebSocket、背景工作進入租戶時）。 */
export function annotateTenant(code: string): void {
  trace.getActiveSpan()?.setAttribute(TENANT_ATTRIBUTE, code);
}

/**
 * 在一個新的 span 裡執行 `fn`：拋錯時記下例外並標成錯誤，再原樣拋出。
 * 不放查詢參數、請求內容這類可能含個資的屬性（同日誌的規則，docs/conventions/03-backend.md §7）。
 */
export function inSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * 程序關閉前把還在批次裡的 span 送出（`src/instrumentation.ts` 註冊的 provider）。沒有載入 tracing 時什麼都不做。
 */
export async function flushTraces(): Promise<void> {
  const provider = trace.getTracerProvider();
  const delegate: unknown =
    provider instanceof ProxyTracerProvider ? provider.getDelegate() : provider;
  if (
    typeof delegate === 'object' &&
    delegate !== null &&
    'forceFlush' in delegate &&
    typeof delegate.forceFlush === 'function'
  ) {
    await (delegate.forceFlush as () => Promise<void>)();
  }
}

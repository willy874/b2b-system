import type { Span, SpanProcessor } from '@opentelemetry/sdk-trace-node';

import { redactUrl } from '../logger/sensitive-query';

/** 帶網址的屬性：http 的 instrumentation 記 `url.query`、Nest 的記 `url.full`。 */
const URL_ATTRIBUTES = ['url.full', 'url.query', 'http.target', 'http.url'] as const;

/**
 * 網址裡的憑證參數（`token`、`code`…）在 span 建立時就遮掉，與日誌同一份名單（`core/logger/sensitive-query.ts`；docs/architecture/08-monitoring.md §3.3）：
 * trace 存在 Tempo、看得到的人比看得到日誌的人多，不能留下啟用連結或授權碼。
 */
export class RedactUrlProcessor implements SpanProcessor {
  onStart(span: Span): void {
    const { attributes } = span;
    for (const key of URL_ATTRIBUTES) {
      const value = attributes[key];
      if (typeof value !== 'string') continue;
      // url.query 不帶 `?`：補上再遮，才對得上 `[?&]token=` 的形狀
      const redacted = key === 'url.query' ? redactUrl(`?${value}`)?.slice(1) : redactUrl(value);
      if (redacted !== undefined && redacted !== value) span.setAttribute(key, redacted);
    }
  }

  onEnd(): void {}

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

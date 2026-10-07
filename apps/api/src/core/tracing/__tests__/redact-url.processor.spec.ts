import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { describe, expect, it } from 'vitest';

import { RedactUrlProcessor } from '../redact-url.processor';

function tracerWithExporter() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new RedactUrlProcessor(), new SimpleSpanProcessor(exporter)],
  });
  return { tracer: provider.getTracer('test'), exporter };
}

describe('RedactUrlProcessor（trace 不留憑證參數，docs/architecture/08-monitoring.md §3.3）', () => {
  it('url.full 與 url.query 裡的 token、code 換成 [Redacted]，其他參數保留', () => {
    const { tracer, exporter } = tracerWithExporter();
    tracer
      .startSpan('GET /auth/activate', {
        attributes: {
          'url.full': '/auth/activate?token=abc123&lang=zh-TW',
          'url.query': 'code=xyz&state=s1&limit=20',
        },
      })
      .end();

    const [span] = exporter.getFinishedSpans();
    expect(span?.attributes['url.full']).toBe('/auth/activate?token=[Redacted]&lang=zh-TW');
    expect(span?.attributes['url.query']).toBe('code=[Redacted]&state=[Redacted]&limit=20');
  });

  it('沒有憑證參數的網址原樣保留', () => {
    const { tracer, exporter } = tracerWithExporter();
    tracer.startSpan('GET /users', { attributes: { 'url.query': 'limit=20&offset=40' } }).end();

    expect(exporter.getFinishedSpans()[0]?.attributes['url.query']).toBe('limit=20&offset=40');
  });
});

import { describe, expect, it } from 'vitest';

import { isMonitoringEnabled, tracingEndpointOf } from '../tracing-endpoint';

function reader(values: Record<string, string>) {
  return (key: string): string | undefined => values[key];
}

describe('tracingEndpointOf（instrumentation.ts 要不要載入 tracing，docs/architecture/08-monitoring.md §3.1）', () => {
  it('設了 OTEL_EXPORTER_OTLP_ENDPOINT 且監控沒有關閉時回傳位址', () => {
    expect(tracingEndpointOf(reader({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://tempo:4318' }))).toBe(
      'http://tempo:4318',
    );
    expect(
      tracingEndpointOf(
        reader({ MONITORING_ENABLED: 'true', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://tempo:4318' }),
      ),
    ).toBe('http://tempo:4318');
  });

  it('MONITORING_ENABLED=false 時不載入，即使設了位址', () => {
    expect(
      tracingEndpointOf(
        reader({ MONITORING_ENABLED: 'false', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://tempo:4318' }),
      ),
    ).toBeUndefined();
  });

  it('沒設位址時不載入', () => {
    expect(tracingEndpointOf(reader({}))).toBeUndefined();
  });
});

describe('isMonitoringEnabled', () => {
  it('只有明確的 false 才關閉；沒設定時開啟', () => {
    expect(isMonitoringEnabled(reader({}))).toBe(true);
    expect(isMonitoringEnabled(reader({ MONITORING_ENABLED: 'true' }))).toBe(true);
    expect(isMonitoringEnabled(reader({ MONITORING_ENABLED: 'false' }))).toBe(false);
  });
});

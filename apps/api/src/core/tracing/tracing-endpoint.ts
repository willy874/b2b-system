/**
 * 讀一個環境變數：空字串與只有空白視為沒設定（同 `env.schema.ts` 的 preprocess）。
 * `src/instrumentation.ts` 早於 ConfigModule 執行，自己照 `@nestjs/config` 的順序組出這個函式。
 */
export type RawEnvReader = (key: string) => string | undefined;

/**
 * 監控整套的開關 `MONITORING_ENABLED`（docs/architecture/08-monitoring.md §1.1）：只有明確設成 `false` 才關閉；
 * 其他非法的值由 `env.schema.ts` 在啟動時擋下。
 */
export function isMonitoringEnabled(read: RawEnvReader): boolean {
  return read('MONITORING_ENABLED') !== 'false';
}

/**
 * 要載入 tracing 時回傳 OTLP 的位址；監控關閉或沒設 `OTEL_EXPORTER_OTLP_ENDPOINT` 時回 `undefined`（什麼都不載入）。
 * 不 import 任何模組：`instrumentation.ts` 必須早於 `http` 等模組被載入。
 */
export function tracingEndpointOf(read: RawEnvReader): string | undefined {
  return isMonitoringEnabled(read) ? read('OTEL_EXPORTER_OTLP_ENDPOINT') : undefined;
}

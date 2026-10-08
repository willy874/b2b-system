import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node';
import {
  ATTR_HTTP_ROUTE,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { parse } from 'dotenv';

import { processRolesOf, serviceNameOf } from './core/config/process-roles';
import { routeLabelOf } from './core/metrics/route-label';
import { RedactUrlProcessor } from './core/tracing/redact-url.processor';
import { tracingEndpointOf } from './core/tracing/tracing-endpoint';

/**
 * OpenTelemetry tracing（docs/architecture/08-monitoring.md §3）。
 *
 * ★ 必須在 `http`、`@nestjs/core`、`pino` 被 require **之前** 執行（instrumentation 以 require hook 包裝模組），
 * 所以進入點第一個 import 它（`main.external.ts` 在 `external-process-env` 之後，名稱才分得出是哪個程序）。
 * 這時 ConfigModule 還沒載入：照 `@nestjs/config` 的優先順序自己讀環境變數與 `.env`；格式驗證仍在 `env.schema.ts`。
 *
 * `OTEL_EXPORTER_OTLP_ENDPOINT` 沒設定、或監控整套關閉（`MONITORING_ENABLED=false`）時什麼都不載入：
 * `@opentelemetry/api` 維持空操作，手動 span 也沒有成本。
 */

/** 與 `ConfigModule` 的 `envFilePath` 相同：先找 app 目錄，再找 repo 根目錄。 */
const ENV_FILES = ['.env', '../../.env'];

function readEnvFiles(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const file of ENV_FILES.toReversed()) {
    try {
      Object.assign(values, parse(readFileSync(file)));
    } catch {
      // 沒有這個檔案（正式環境只用環境變數）
    }
  }
  return values;
}

const fileEnv = readEnvFiles();

/** `process.env` 優先，其次 `.env`；空字串視為沒設定（同 env.schema 的 preprocess）。 */
function envValue(key: string): string | undefined {
  const value = process.env[key] ?? fileEnv[key];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/** 不產生 span 的請求：探針與指標抓取，量多又沒有排查價值。 */
const IGNORED_PATHS = /^\/(health(\/|$)|metrics$|_health$)/;

function startTracing(endpoint: string): void {
  const surface = envValue('API_SURFACE') ?? 'internal';
  const ratio = Number(envValue('OTEL_TRACES_SAMPLER_ARG') ?? '1');
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      // 與 Prometheus 的 job 名稱相同：Grafana 從 trace 跳到同一個服務的指標（deploy/monitoring/prometheus.yml）；
      // 內部 api 拆成角色時帶角色（api-http、api-worker…，docs/features/multi-instance.md）
      [ATTR_SERVICE_NAME]:
        envValue('OTEL_SERVICE_NAME') ??
        (surface === 'external'
          ? 'external-api'
          : serviceNameOf(processRolesOf({ APP_ROLES: envValue('APP_ROLES') }))),
      [ATTR_SERVICE_VERSION]: envValue('APP_RELEASE') ?? 'unknown',
      'deployment.environment.name': envValue('NODE_ENV') ?? 'development',
    }),
    // 上游（之後的前端、對外 API 的呼叫端）帶了取樣決定就照它；沒有時依比例
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(Number.isFinite(ratio) ? ratio : 1),
    }),
    spanProcessors: [
      new RedactUrlProcessor(),
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
      ),
    ],
  });
  provider.register();

  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => IGNORED_PATHS.test(req.url?.split('?')[0] ?? ''),
        // 根 span 的名稱與 http.route 用路由樣板（與指標的 route 標籤同一個函式）：@opentelemetry/instrumentation-express
        // 對 Nest 12 的 Express 5 不產生 span，http.route 不會被自動補上
        applyCustomAttributesOnSpan: (span, request, response) => {
          // 只處理伺服器端（ServerResponse 帶著它的 req）；對外連線已在上面略過。只用型別、不 import node:http 的值：
          // 這裡比 http 的 instrumentation 早載入
          if (!('req' in response)) return;
          const { statusCode } = response as ServerResponse;
          const route = routeLabelOf(request as IncomingMessage, statusCode);
          span.setAttribute(ATTR_HTTP_ROUTE, route);
          span.updateName(`${request.method ?? 'HTTP'} ${route}`);
        },
        // 物件儲存的請求由 aws-sdk 的 span 表示；這裡只留下 webhook、外部 IdP 等其他對外連線（undici）
        ignoreOutgoingRequestHook: () => true,
      }),
      new NestInstrumentation(),
      new UndiciInstrumentation(),
      new AwsInstrumentation({ suppressInternalInstrumentation: true }),
      // 日誌加上 trace_id、span_id：Grafana 從日誌跳到 trace
      new PinoInstrumentation(),
    ],
  });
}

const endpoint = tracingEndpointOf(envValue);
if (endpoint) startTracing(endpoint);

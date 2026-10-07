import { isVitalName, type VitalName } from '@/metrics/apm-metrics';

/**
 * 從 SDK 送來的 transaction 與 span 取出 Web Vitals（設計決策 D10）。
 * SDK 不同版本放的位置不同，這裡都認：
 *
 * - transaction 的 `measurements`：`{ lcp: { value, unit } }`（舊版的 pageload）
 * - span 的屬性 `browser.web_vital.<名稱>.value`（v10 起的 web vital span；在 transaction 的 `spans`、
 *   獨立的 `span` 項目，或 span streaming 的 `{ items: [...] }`）
 * - `op: navigation` 的 transaction：起訖時間差當成路由切換耗時
 */
export interface VitalSample {
  route: string | undefined;
  name: VitalName;
  value: number;
}

const ATTRIBUTE_PATTERN = /^browser\.web_vital\.([a-z]+)\.value$/;
const ROUTE_ATTRIBUTES = ['sentry.segment.name', 'sentry.transaction', 'transaction'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** span streaming 的屬性是 `{ value, type }`；舊格式直接是值。 */
function attributeValue(raw: unknown): unknown {
  return isRecord(raw) && 'value' in raw ? raw.value : raw;
}

function attributesOf(span: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(isRecord(span.data) ? span.data : {}),
    ...(isRecord(span.attributes) ? span.attributes : {}),
  };
}

function routeOf(
  attributes: Record<string, unknown>,
  fallback: string | undefined,
): string | undefined {
  for (const key of ROUTE_ATTRIBUTES) {
    const value = attributeValue(attributes[key]);
    if (typeof value === 'string' && value !== '') return value;
  }
  return fallback;
}

function fromSpan(span: unknown, fallbackRoute: string | undefined): VitalSample[] {
  if (!isRecord(span)) return [];
  const attributes = attributesOf(span);
  const route = routeOf(attributes, fallbackRoute);
  const samples: VitalSample[] = [];
  for (const [key, raw] of Object.entries(attributes)) {
    const name = ATTRIBUTE_PATTERN.exec(key)?.[1];
    const value = attributeValue(raw);
    if (name !== undefined && isVitalName(name) && typeof value === 'number') {
      samples.push({ route, name, value });
    }
  }
  return samples;
}

export function vitalsFromTransaction(event: Record<string, unknown>): VitalSample[] {
  const route = typeof event.transaction === 'string' ? event.transaction : undefined;
  const samples: VitalSample[] = [];
  if (isRecord(event.measurements)) {
    for (const [name, measurement] of Object.entries(event.measurements)) {
      const value = isRecord(measurement) ? measurement.value : undefined;
      if (isVitalName(name) && typeof value === 'number') samples.push({ route, name, value });
    }
  }
  if (Array.isArray(event.spans)) {
    for (const span of event.spans) samples.push(...fromSpan(span, route));
  }
  const trace =
    isRecord(event.contexts) && isRecord(event.contexts.trace) ? event.contexts.trace : {};
  const start = event.start_timestamp;
  const end = event.timestamp;
  if (
    trace.op === 'navigation' &&
    typeof start === 'number' &&
    typeof end === 'number' &&
    end >= start
  ) {
    samples.push({ route, name: 'navigation', value: (end - start) * 1000 });
  }
  return samples;
}

/** 獨立的 `span` 項目，或 span streaming 的 `span` 容器（`{ items: [...] }`）。 */
export function vitalsFromSpanItem(payload: Record<string, unknown>): VitalSample[] {
  const spans = Array.isArray(payload.items) ? payload.items : [payload];
  return spans.flatMap((span) => fromSpan(span, undefined));
}

import { Counter, Histogram } from './registry';

/** 支援的 Web Vital 與路由切換耗時；`cls` 沒有單位，其餘是毫秒。 */
export const VITAL_NAMES = ['lcp', 'inp', 'cls', 'fcp', 'ttfb', 'navigation'] as const;
export type VitalName = (typeof VITAL_NAMES)[number];

const MS_BUCKETS = [100, 250, 500, 1000, 1500, 2500, 4000, 6000, 10_000, 20_000] as const;
const INP_BUCKETS = [50, 100, 200, 300, 500, 1000, 2000] as const;
const CLS_BUCKETS = [0.01, 0.05, 0.1, 0.15, 0.25, 0.5, 1] as const;

const BUCKETS: Record<VitalName, readonly number[]> = {
  lcp: MS_BUCKETS,
  inp: INP_BUCKETS,
  cls: CLS_BUCKETS,
  fcp: MS_BUCKETS,
  ttfb: MS_BUCKETS,
  navigation: MS_BUCKETS,
};

export function isVitalName(value: string): value is VitalName {
  return (VITAL_NAMES as readonly string[]).includes(value);
}

/** 超過上限之後的新 route 都歸到這一個標籤值。 */
export const OTHER_ROUTE = 'other';
const ROUTE_PATTERN = /^[A-Za-z0-9_./$:-]{1,120}$/;

/**
 * apm-service 自己的 `/metrics`（設計決策 D10）。route 標籤是頁面的 path 樣板，來自客戶端，
 * 所以每個專案限制種類數，防止被灌入任意值讓時間序列爆量。
 */
export class ApmMetrics {
  readonly envelopes = new Counter('apm_envelopes_total', '收到的 envelope 數（依結果）');
  readonly items = new Counter('apm_items_total', '收到的 envelope 項目數（依類型）');
  readonly vitals = new Histogram(
    'apm_web_vital',
    'Web Vitals 與路由切換耗時（cls 無單位，其餘毫秒）',
    (labels) => BUCKETS[labels.name as VitalName] ?? MS_BUCKETS,
  );

  private readonly routes = new Map<string, Set<string>>();

  constructor(private readonly routeLabelLimit: number) {}

  private routeLabel(project: string, route: string | undefined): string {
    if (route === undefined || !ROUTE_PATTERN.test(route)) return OTHER_ROUTE;
    let known = this.routes.get(project);
    if (!known) {
      known = new Set();
      this.routes.set(project, known);
    }
    if (known.has(route)) return route;
    if (known.size >= this.routeLabelLimit) return OTHER_ROUTE;
    known.add(route);
    return route;
  }

  observeVital(project: string, route: string | undefined, name: VitalName, value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.vitals.observe({ project, route: this.routeLabel(project, route), name }, value);
  }

  render(): string {
    return `${[this.envelopes.render(), this.items.render(), this.vitals.render()].join('\n')}\n`;
  }
}

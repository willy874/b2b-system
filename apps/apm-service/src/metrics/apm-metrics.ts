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

/** 格式不對的 release。 */
export const OTHER_RELEASE = 'other';
/** 事件沒有帶 release（開發、未設定 `APP_RELEASE` 的建置）。 */
export const UNKNOWN_RELEASE = 'unknown';
/** 與 release 檔案 API 接受的形狀相同（docs/architecture/07-apm-service.md §3.2）；其他的歸 `other`。 */
const RELEASE_PATTERN = /^[A-Za-z0-9._+-]{1,100}$/;
/** 與 Sentry 相同的事件等級；客戶端送別的值時 normalize 已經改成 `error`。 */
const LEVELS = new Set(['fatal', 'error', 'warning', 'info', 'debug', 'log']);

/**
 * apm-service 自己的 `/metrics`（docs/architecture/frontend/19-observability.md §9.2 D10）。route 標籤是頁面的 path 樣板，來自客戶端，
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

  readonly events = new Counter(
    'apm_events_total',
    '存下的錯誤事件數（依專案、等級、release；release 只保留最近的幾個）',
  );

  private readonly routes = new Map<string, Set<string>>();
  /** 每個專案最近看到的 release（Map 依插入順序：最後一個是最近的）。 */
  private readonly releases = new Map<string, Map<string, true>>();

  constructor(
    private readonly routeLabelLimit: number,
    private readonly releaseLabelLimit: number = 10,
  ) {}

  /**
   * release 標籤：只保留每個專案最近看到的 `releaseLabelLimit` 個（docs/architecture/08-monitoring.md §5.1）。
   * 每次部署都是新的 release，不淘汰的話時間序列會一直長；被淘汰的 release 連同它的時間序列一起刪掉，
   * 看舊版本的錯誤數要回到 Prometheus 的歷史資料。
   */
  private releaseLabel(project: string, release: string | undefined): string {
    if (release === undefined) return UNKNOWN_RELEASE;
    if (!RELEASE_PATTERN.test(release)) return OTHER_RELEASE;
    let known = this.releases.get(project);
    if (!known) {
      known = new Map();
      this.releases.set(project, known);
    }
    known.delete(release);
    known.set(release, true);
    if (known.size > this.releaseLabelLimit) {
      const oldest = known.keys().next();
      if (!oldest.done) {
        known.delete(oldest.value);
        this.events.remove(
          (labels) => labels.project === project && labels.release === oldest.value,
        );
      }
    }
    return release;
  }

  countEvent(project: string, level: string, release: string | undefined): void {
    this.events.inc({
      project,
      level: LEVELS.has(level) ? level : 'error',
      release: this.releaseLabel(project, release),
    });
  }

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
    return `${[this.envelopes.render(), this.items.render(), this.events.render(), this.vitals.render()].join('\n')}\n`;
  }
}

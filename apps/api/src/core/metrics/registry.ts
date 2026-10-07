import { collectDefaultMetrics, Gauge, Registry } from 'prom-client';
import type { GaugeConfiguration } from 'prom-client';

/**
 * 這個程序的指標（docs/architecture/08-monitoring.md §2）。不用 prom-client 的全域 registry：
 * 第三方套件註冊的指標不會混進來，測試也能各自檢查。
 */
export const metricsRegistry = new Registry();

// Node 的標準指標（event loop 延遲、heap、GC、CPU、開著的 handle）；名稱照 prom-client 的慣例，社群的儀表板直接可用
collectDefaultMetrics({ register: metricsRegistry });

type Labels<T extends string> = Partial<Record<T, string | number>>;

/** 抓取時回報目前的值：`set(labels, value)` 同一組標籤的值會相加（同一個程序有兩個來源時，例：整合測試的兩個 app）。 */
export type GaugeReporter<T extends string> = (labels: Labels<T>, value: number) => void;
export type GaugeObserver<T extends string> = (report: GaugeReporter<T>) => void | Promise<void>;

/**
 * 「抓取時才去問」的 gauge：快取大小、開著的連線池、佇列深度這類 **狀態**。
 * 來源以 `WeakRef` 登記：擁有者被回收（測試裡建了又丟的 app）就自動不再回報，不必另外在關閉時取消。
 */
export class ObservedGauge<T extends string> {
  private readonly observers = new Map<
    string,
    { owner: WeakRef<object>; observe: GaugeObserver<T> }
  >();
  private nextId = 0;
  /** 登記在 `metricsRegistry` 的 gauge；值只在 `collect` 裡設定。 */
  readonly gauge: Gauge<T>;

  constructor(configuration: Omit<GaugeConfiguration<T>, 'collect' | 'registers'>) {
    const observers = this.observers;
    this.gauge = new Gauge<T>({
      ...configuration,
      registers: [metricsRegistry],
      async collect() {
        const totals = new Map<string, { labels: Labels<T>; value: number }>();
        const report: GaugeReporter<T> = (labels, value) => {
          const key = JSON.stringify(
            Object.entries(labels).toSorted(([a], [b]) => a.localeCompare(b)),
          );
          const entry = totals.get(key);
          if (entry) entry.value += value;
          else totals.set(key, { labels, value });
        };
        for (const [id, { owner, observe }] of observers) {
          if (!owner.deref()) {
            observers.delete(id);
            continue;
          }
          // oxlint-disable-next-line no-await-in-loop -- 來源只有幾個；依序問，失敗的不影響其他
          await Promise.resolve(observe(report)).catch(() => undefined);
        }
        this.reset();
        for (const { labels, value } of totals.values()) this.set(labels, value);
      },
    });
  }

  /** 登記一個來源；`owner` 被回收或呼叫回傳的函式後停止回報。 */
  observe(owner: object, observe: GaugeObserver<T>): () => void {
    const id = String(this.nextId++);
    this.observers.set(id, { owner: new WeakRef(owner), observe });
    return () => {
      this.observers.delete(id);
    };
  }
}

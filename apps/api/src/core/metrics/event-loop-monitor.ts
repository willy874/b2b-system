import { monitorEventLoopDelay } from 'node:perf_hooks';

import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';

/** 每隔多久換一個量測窗：就緒檢查看的是「最近這一段」，不是程序啟動以來的累計。 */
const WINDOW_MS = 30_000;

/**
 * event loop 延遲（docs/architecture/08-monitoring.md §4）：就緒檢查用。Prometheus 的 `nodejs_eventloop_lag_*`
 * 由 prom-client 的預設指標另外量，這裡只保留最近一個量測窗的 p99。
 */
@Injectable()
export class EventLoopMonitor implements OnModuleDestroy {
  private readonly histogram = monitorEventLoopDelay({ resolution: 20 });
  private readonly timer: NodeJS.Timeout;
  /** 上一個完整量測窗的 p99（毫秒）；第一個窗還沒結束時讀目前的。 */
  private lastP99Ms: number | undefined;

  constructor() {
    this.histogram.enable();
    this.timer = setInterval(() => {
      this.lastP99Ms = this.currentP99Ms();
      this.histogram.reset();
    }, WINDOW_MS);
    // 只是量測：不讓它單獨撐住程序（測試、CLI 結束時）
    this.timer.unref();
  }

  /** 最近一個量測窗的 p99 延遲（毫秒）。 */
  p99Ms(): number {
    return this.lastP99Ms ?? this.currentP99Ms();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.histogram.disable();
  }

  private currentP99Ms(): number {
    // 還沒有任何樣本時 percentile 回 0
    return this.histogram.percentile(99) / 1e6;
  }
}

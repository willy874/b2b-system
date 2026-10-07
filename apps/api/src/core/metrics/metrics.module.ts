import { Global, Module } from '@nestjs/common';

import { EventLoopMonitor } from './event-loop-monitor';
import { MetricsServer } from './metrics-server';

/**
 * 指標（docs/architecture/08-monitoring.md §2）。指標本身是模組層級的單例（`instruments.ts`），
 * 這裡只管給 Prometheus 抓的 server 與就緒檢查用的 event loop 量測。
 */
@Global()
@Module({
  providers: [MetricsServer, EventLoopMonitor],
  exports: [EventLoopMonitor],
})
export class MetricsModule {}

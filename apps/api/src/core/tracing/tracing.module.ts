import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

import { flushTraces } from './tracing';

/** 關閉時送出批次裡剩下的 span（BatchSpanProcessor 每 5 秒送一次，不送就會掉最後一段）。 */
@Injectable()
export class TraceFlusher implements OnApplicationShutdown {
  private readonly logger = new Logger(TraceFlusher.name);

  async onApplicationShutdown(): Promise<void> {
    try {
      await flushTraces();
    } catch (error) {
      this.logger.warn({ err: error }, '關閉前送出 trace 失敗');
    }
  }
}

@Global()
@Module({ providers: [TraceFlusher] })
export class TracingModule {}

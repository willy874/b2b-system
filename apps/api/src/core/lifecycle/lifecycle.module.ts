import { Global, Module } from '@nestjs/common';

import { ShutdownState } from './shutdown-state';

/** 程序的結束與排空（全域）；訊號處理在進入點呼叫 `enableGracefulShutdown`。 */
@Global()
@Module({
  providers: [ShutdownState],
  exports: [ShutdownState],
})
export class LifecycleModule {}

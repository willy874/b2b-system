import { Global, Module } from '@nestjs/common';

import { BroadcastService } from './broadcast.service';

/** 程序之間的失效廣播（平台 DB 的 `LISTEN`／`NOTIFY`）；全域。 */
@Global()
@Module({
  providers: [BroadcastService],
  exports: [BroadcastService],
})
export class BroadcastModule {}

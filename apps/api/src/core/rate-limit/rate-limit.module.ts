import { Global, Module } from '@nestjs/common';

import { LoginThrottle } from './login-throttle';
import { MemoryRateLimitStore, RateLimitStore } from './rate-limit-store';

/** 速率限制的計數（全域）：限流 guard 與登入的漸進延遲共用同一份計數。 */
@Global()
@Module({
  providers: [{ provide: RateLimitStore, useClass: MemoryRateLimitStore }, LoginThrottle],
  exports: [RateLimitStore, LoginThrottle],
})
export class RateLimitModule {}

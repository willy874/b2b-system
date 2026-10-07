import { Global, Module } from '@nestjs/common';

import { AccessTokenKeys } from './access-token.keys';
import { AccessTokenVerifier } from './access-token.verifier';

/**
 * `AccessTokenVerifier` 同時被全域 Guard（AppModule）與 `RealtimeModule` 的 gateway 使用，
 * 設為 @Global 讓兩邊注入同一個實例，不必各自宣告 provider。
 */
@Global()
@Module({
  providers: [AccessTokenKeys, AccessTokenVerifier],
  exports: [AccessTokenKeys, AccessTokenVerifier],
})
export class AccessTokenModule {}

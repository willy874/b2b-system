import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';

import { validateEnv } from './env.schema';
import type { Env } from './env.schema';

/** 型別安全的 ConfigService：`get('PORT')` 會推導出 number。 */
export type TypedConfigService = ConfigService<Env, true>;

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
      // 只回傳驗證後的值。否則 schema 把 `KEY=`（空字串）轉成 undefined 時，get() 會退回
      // process.env 的原始 ''，程式裡的 `?? 預設值` 不生效（例：OIDC cookie 沒有金鑰）
      skipProcessEnv: true,
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}

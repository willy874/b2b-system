import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

import type { Env } from '../config';
import { UsageMeter } from './usage-meter';
import type { UsageCounter } from './usage-meter';

/** 不算進用量的路徑：負載平衡器與監控的探測。 */
const UNMETERED_PATH = /^\/health(\/|$)/i;

/**
 * 每個請求在租戶的 middleware（`TenantMiddleware`／`TokenTenantMiddleware`）之後記一次（docs/architecture/05-tenancy.md §14.2 D10）：
 * 那時已經在租戶的脈絡裡，被 guard 擋下的請求（401、403、429）也算——它們一樣佔用了服務。
 * 內部 api 與對外 API 分開計（`API_SURFACE`）。
 */
@Injectable()
export class UsageRequestMiddleware implements NestMiddleware {
  private readonly counter: UsageCounter;

  constructor(
    private readonly meter: UsageMeter,
    config: ConfigService<Env, true>,
  ) {
    this.counter =
      config.get('API_SURFACE', { infer: true }) === 'external'
        ? 'requestsExternal'
        : 'requestsInternal';
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    if (!UNMETERED_PATH.test(req.originalUrl)) this.meter.count(this.counter);
    next();
  }
}

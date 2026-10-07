import type { NextFunction, Request, Response } from 'express';

import { httpRequestDuration } from './instruments';
import { routeLabelOf } from './route-label';

/**
 * 量每個 HTTP 請求的時間（docs/architecture/08-monitoring.md §2.2）。進入點最先 `app.use()` 它：
 * 被 guard 擋下（401、403、429）與路由沒對到的請求也要算進去。在 `close` 結束量測，客戶端中途斷線也記得到。
 */
export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer();
  res.once('close', () => {
    const status = res.headersSent ? res.statusCode : 499;
    end({ method: req.method, route: routeLabelOf(req, status), status });
  });
  next();
}

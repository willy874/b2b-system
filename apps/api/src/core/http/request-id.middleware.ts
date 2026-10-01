import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { CLIENT_ID_HEADER, isValidClientId } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { runWithRequestContext } from './request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * 請求的 id：沿用 pino-http 已指派的（`core/logger` 的 `genReqId` 也呼叫這裡，`req.id`），否則取客戶端帶來的
 * `x-request-id`（64 字以內），再不然產生一個。兩邊用同一個值，日誌的 `requestId` 才對得上回應標頭與稽核紀錄。
 */
export function resolveRequestId(req: IncomingMessage & { id?: unknown }): string {
  if (typeof req.id === 'string') return req.id;
  const incoming = req.headers[REQUEST_ID_HEADER];
  return typeof incoming === 'string' && incoming && incoming.length <= 64
    ? incoming
    : randomUUID();
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = resolveRequestId(req);
    // 格式不合就忽略：它只用來去重，不值得為它拒絕請求
    const clientId = req.header(CLIENT_ID_HEADER);
    res.setHeader(REQUEST_ID_HEADER, requestId);

    runWithRequestContext(
      {
        requestId,
        ip: req.ip,
        userAgent: req.header('user-agent'),
        clientId: isValidClientId(clientId) ? clientId : undefined,
      },
      () => next(),
    );
  }
}

import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { runWithRequestContext } from './request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, requestId);

    runWithRequestContext(
      {
        requestId,
        ip: req.ip,
        userAgent: req.header('user-agent'),
      },
      () => next(),
    );
  }
}

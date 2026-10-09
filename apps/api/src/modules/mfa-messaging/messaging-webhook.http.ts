import type { INestApplication } from '@nestjs/common';
import { json } from 'express';
import type { Request, Response } from 'express';

/** 收 webhook 時留下的原始本體：LINE 的簽章是對原始的位元組算的，重新序列化的 JSON 對不上。 */
export type RequestWithRawBody = Request & { rawBody?: Buffer };

export const LINE_WEBHOOK_PATH = '/mfa-channels/line/webhook';

/**
 * LINE webhook 的 body parser（docs/architecture/backend/21-mfa.md §9.5）：解析 JSON 的同時保留原始本體給簽章驗證。
 * 必須在 `app.init()`（`listen()`）之前呼叫，與 `registerDataTransferBodyParser` 相同的做法。
 */
export function registerMfaChannelBodyParser(app: INestApplication): void {
  const parser = json({
    limit: '1mb',
    verify: (request, _response, buffer) => {
      (request as RequestWithRawBody).rawBody = Buffer.from(buffer);
    },
  });
  // 包一層：Nest 以函式名稱 `jsonParser` 判斷是否已經註冊過 JSON parser
  app.use(LINE_WEBHOOK_PATH, (request: Request, response: Response, next: () => void) =>
    parser(request, response, next),
  );
}

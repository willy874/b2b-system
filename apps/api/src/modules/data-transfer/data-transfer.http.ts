import { createParamDecorator, Injectable } from '@nestjs/common';
import type {
  CallHandler,
  ExecutionContext,
  INestApplication,
  NestInterceptor,
} from '@nestjs/common';
import { json } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import type { Observable } from 'rxjs';

import { AppException } from '@/core/errors';
import { DATA_TRANSFER_IMPORT_MAX_SIZE_MB_PARAM, tenantFeatureParam } from '@/core/tenant';

const MIB = 1024 * 1024;

/**
 * `POST /data-transfers/imports` 的請求本體可能有數 MB（5 000 列 × 15 欄的 JSON）：只對這條路由放寬 JSON 的上限，
 * 其他路由維持框架預設（docs/architecture/backend/22-data-transfer.md §4.2）。這裡的上限是 feature 參數最大值的兩倍，
 * 租戶的實際上限（`dataTransfer.importMaxSizeMb` × 2）由 service 依 `Content-Length` 檢查。
 *
 * 必須在 `app.init()`（`listen()`）之前呼叫：先註冊的 parser 讀完本體後，Nest 預設的 parser 會略過這個請求。
 */
export function registerDataTransferBodyParser(app: INestApplication): void {
  const parser = json({ limit: `${DATA_TRANSFER_IMPORT_MAX_SIZE_MB_PARAM.max * 2 + 1}mb` });
  // 包一層：Nest 以函式名稱 `jsonParser` 判斷是否已經註冊過 JSON parser，直接交出 `json()` 會讓它略過全域的那一個
  app.use('/data-transfers/imports', (request: Request, response: Response, next: () => void) =>
    parser(request, response, next),
  );
}

/** 請求本體的位元組數（`Content-Length`）；沒有時是 0。 */
export const RequestContentLength = createParamDecorator(
  (_data: unknown, context: ExecutionContext): number => {
    const value = Number(context.switchToHttp().getRequest<Request>().headers['content-length']);
    return Number.isFinite(value) && value > 0 ? value : 0;
  },
);

/** 分析上傳的檔案（記憶體中的位元組；不落地、不進 bucket，§13 D22）。 */
export interface UploadedSheet {
  originalname: string;
  size: number;
  buffer: Buffer;
}

/**
 * api 第一個收 multipart 的端點（§7.3、D22）：只收單一檔案 `file`，大小上限是租戶的 `dataTransfer.importMaxSizeMb`，
 * 在串流讀取時就累計，超過立即中斷並回 `413 DATA_TRANSFER_FILE_TOO_LARGE`。文字欄位（mode、mapping…）放在 `req.body`。
 */
@Injectable()
export class ImportUploadInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const maxBytes = tenantFeatureParam(DATA_TRANSFER_IMPORT_MAX_SIZE_MB_PARAM) * MIB;
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: maxBytes, files: 1, fields: 10, fieldSize: 64 * 1024, parts: 12 },
    }).single('file');
    await new Promise<void>((resolve, reject) => {
      upload(request, response, (error: unknown) => {
        if (!error) return resolve();
        if (error instanceof multer.MulterError) {
          if (error.code === 'LIMIT_FILE_SIZE') {
            return reject(new AppException('DATA_TRANSFER_FILE_TOO_LARGE', { maxBytes }));
          }
          return reject(new AppException('VALIDATION_FAILED', { fields: { file: error.code } }));
        }
        reject(new AppException('DATA_TRANSFER_FILE_UNREADABLE', { reason: 'multipart' }));
      });
    });
    return next.handle();
  }
}

/** 取 `ImportUploadInterceptor` 收下的檔案；沒有檔案時拋 `VALIDATION_FAILED`。 */
export const UploadedImportFile = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UploadedSheet => {
    const file = context.switchToHttp().getRequest<Request & { file?: UploadedSheet }>().file;
    if (!file) throw new AppException('VALIDATION_FAILED', { fields: { file: 'required' } });
    return file;
  },
);

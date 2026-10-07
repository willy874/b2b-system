import type { IncomingMessage } from 'node:http';

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { Options } from 'pino-http';

import type { Env } from '../config';
import { resolveRequestId } from '../http';
import { clientReleaseOf } from './client-release';
import { redactRequest, serializeError } from './redact';

/** 開發時多看 debug；測試靜音（整合測試以 `logger: false` 建 app，單元測試不經過這裡）。 */
const LOG_LEVEL = { development: 'debug', production: 'info', test: 'silent' } as const;

/**
 * pino-http 的選項（LoggerModule 與遮蔽的測試共用同一份）。
 * 憑證不進日誌：access token、refresh cookie（請求與回應）以 `redact` 遮整個欄位；
 * 網址、`query` 與 Referer 裡的憑證參數由 `redactRequest` 遮（名單是 `SENSITIVE_QUERY_KEYS`）；
 * 錯誤由 `serializeError` 拿掉查詢參數。
 */
export function pinoHttpOptions(nodeEnv: Env['NODE_ENV']): Options {
  return {
    level: LOG_LEVEL[nodeEnv],
    transport:
      nodeEnv === 'development'
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
    // 請求的 id 與 RequestIdMiddleware（回應標頭、稽核）是同一個值；欄位名稱用 requestId。
    // quietReqLogger：請求內的應用程式日誌只綁 requestId，不再每筆都帶整份 req（存取日誌照常有）
    genReqId: (req: IncomingMessage) => resolveRequestId(req),
    customAttributeKeys: { reqId: 'requestId' },
    quietReqLogger: true,
    // MFA 的 seed、otpauth URI、備用碼只出現在設定的回應裡（docs/architecture/backend/21-mfa.md §9.1）：
    // 存取日誌不記 body，但任何被記下的物件（錯誤的 details、除錯日誌）帶到這些欄位一樣遮掉
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.otpauthUri',
      '*.secret',
      '*.recoveryCodes',
      '*.publicData',
    ],
    // 資料庫的查詢錯誤不帶參數（密碼雜湊、token、個資）：HTTP 的未知錯誤、IdP 的錯誤、背景工作的失敗都經過這裡
    serializers: { req: redactRequest, err: serializeError },
    // 前端的 release（x-client-release）：日誌平台可以直接依它篩選
    customProps: (req: IncomingMessage) => {
      const clientRelease = clientReleaseOf(req);
      return clientRelease === undefined ? {} : { clientRelease };
    },
    autoLogging: {
      ignore: (req: IncomingMessage) => req.url?.startsWith('/health') === true,
    },
  };
}

/**
 * 結構化日誌（JSON）。欄位含 requestId，可與稽核紀錄對照。
 * HTTP 存取日誌（pino-http）與應用程式日誌（`new Logger(Xxx.name)`，進入點以 `app.useLogger()` 接上）共用這一個 Pino：
 * 等級、`redact` 與 requestId 都一致。請求內的應用程式日誌經 `req.log` 的子 logger 寫出，所以也帶 requestId。
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: pinoHttpOptions(config.get('NODE_ENV', { infer: true })),
      }),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}

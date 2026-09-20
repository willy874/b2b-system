import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import type { Env } from '../config';
import { getRequestId } from '../http';

/** 結構化日誌（JSON）。欄位含 requestId，可與稽核紀錄對照。 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const nodeEnv = config.get('NODE_ENV', { infer: true });
        return {
          pinoHttp: {
            level: nodeEnv === 'test' ? 'silent' : 'info',
            transport:
              nodeEnv === 'development'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
            customProps: () => ({ requestId: getRequestId() }),
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            autoLogging: {
              ignore: (req: { url?: string }) => req.url?.startsWith('/health') === true,
            },
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}

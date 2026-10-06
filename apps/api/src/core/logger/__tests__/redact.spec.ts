import { Writable } from 'node:stream';

import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DrizzleQueryError } from 'drizzle-orm';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { stdSerializers } from 'pino';
import { pinoHttp } from 'pino-http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { pinoHttpOptions } from '../logger.module';
import {
  redactQuery,
  redactRequest,
  redactUrl,
  SENSITIVE_QUERY_KEYS,
  serializeError,
} from '../redact';

/** 寫進記憶體的 Pino 輸出。 */
function memoryStream(lines: string[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
}

describe('日誌遮蔽（docs/conventions/03-backend.md §7）', () => {
  it('遮掉查詢字串裡的 token，保留其他參數', () => {
    expect(redactUrl('/auth/setup/verify?token=abc_123-XYZ')).toBe(
      '/auth/setup/verify?token=[Redacted]',
    );
    expect(redactUrl('/x?a=1&token=abc&b=2')).toBe('/x?a=1&token=[Redacted]&b=2');
    expect(redactUrl('/users?keyword=token')).toBe('/users?keyword=token');
    expect(redactUrl(undefined)).toBeUndefined();
  });

  it('遮掉外部 IdP 回來的 code／state、完成外部登入的 ticket 與 OIDC 的 code_verifier／id_token_hint', () => {
    expect(redactUrl('/oidc-interaction/external/callback?code=c0de&state=st4te&iss=x')).toBe(
      '/oidc-interaction/external/callback?code=[Redacted]&state=[Redacted]&iss=x',
    );
    expect(redactUrl('/oidc-interaction/u1/external/complete?ticket=t1')).toBe(
      '/oidc-interaction/u1/external/complete?ticket=[Redacted]',
    );
    expect(redactUrl('/oidc/session/end?id_token_hint=eyJ&code_verifier=v')).toBe(
      '/oidc/session/end?id_token_hint=[Redacted]&code_verifier=[Redacted]',
    );
    // 參數名稱只是剛好包含這些字的不遮
    expect(redactUrl('/files?zipcode=100&statement=1')).toBe('/files?zipcode=100&statement=1');
  });

  it('網址與 query 物件用同一份參數名單：名單裡的每一個都遮', () => {
    for (const key of SENSITIVE_QUERY_KEYS) {
      expect(redactUrl(`/x?${key}=secret&keep=1`)).toBe(`/x?${key}=[Redacted]&keep=1`);
      expect(redactQuery({ [key]: 'secret', keep: '1' })).toEqual({
        [key]: '[Redacted]',
        keep: '1',
      });
    }
  });

  it('query 物件：同名參數出現多次（陣列）或巢狀的值整個遮掉，不改原本的物件', () => {
    const query = { code: ['a', 'b'], state: { nested: 'x' }, keyword: 'code' };
    expect(redactQuery(query)).toEqual({
      code: '[Redacted]',
      state: '[Redacted]',
      keyword: 'code',
    });
    expect(query.code).toEqual(['a', 'b']);
    expect(redactQuery(undefined)).toBeUndefined();
  });

  it('請求的 URL、query 與 Referer 都遮，不改到請求本身的 headers', () => {
    const headers = { referer: 'http://localhost:5173/auth/setup?token=secret', host: 'x' };
    expect(
      redactRequest({
        url: '/auth/setup/verify?token=secret',
        query: { token: 'secret', page: '2' },
        headers,
      }),
    ).toEqual({
      url: '/auth/setup/verify?token=[Redacted]',
      query: { token: '[Redacted]', page: '2' },
      headers: { referer: 'http://localhost:5173/auth/setup?token=[Redacted]', host: 'x' },
    });
    expect(headers.referer).toBe('http://localhost:5173/auth/setup?token=secret');
  });
});

@Controller()
class ProbeController {
  @Get('x')
  probe(): string {
    return 'ok';
  }
}

describe('請求日誌經過 pino-http 的輸出（docs/architecture/backend/11-mail.md §5）', () => {
  let app: INestApplication;
  let baseUrl: string;
  const lines: string[] = [];

  beforeAll(async () => {
    const stream = memoryStream(lines);
    const moduleRef = await Test.createTestingModule({
      imports: [PinoLoggerModule.forRoot({ pinoHttp: [pinoHttpOptions('production'), stream] })],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('Express 解析好的 query 物件也遮：憑證參數找不到原文，其他參數照常保留', async () => {
    // 值取得夠特別，不會剛好出現在 requestId（uuid）或時間裡
    const secrets = {
      code: 'zz-code-zz',
      state: 'zz-state-zz',
      ticket: 'zz-ticket-zz',
      code_verifier: 'zz-verifier-zz',
      id_token_hint: 'zz-hint-zz',
      token: 'zz-token-zz',
    };
    const response = await fetch(
      `${baseUrl}/x?${new URLSearchParams({ ...secrets, keyword: 'kept-keyword' })}`,
      {
        headers: {
          authorization: 'Bearer zz-bearer-zz',
          referer: 'http://localhost:5173/?token=zz-referer-zz',
        },
      },
    );
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(lines.join('')).toContain('request completed'));

    const output = lines.join('');
    for (const secret of [...Object.values(secrets), 'zz-bearer-zz', 'zz-referer-zz']) {
      expect(output).not.toContain(secret);
    }
    const entry = JSON.parse(lines.find((line) => line.includes('request completed')) ?? '{}');
    expect(entry.req.query).toEqual({
      code: '[Redacted]',
      state: '[Redacted]',
      ticket: '[Redacted]',
      code_verifier: '[Redacted]',
      id_token_hint: '[Redacted]',
      token: '[Redacted]',
      keyword: 'kept-keyword',
    });
    expect(entry.req.url).toContain('keyword=kept-keyword');
  });
});

const UPDATE_SQL = 'update "users" set "password_hash" = $1 where "id" = $2';

/** 驅動錯誤（postgres.js）包在 drizzle 的查詢錯誤裡；參數是密碼雜湊。 */
function passwordUpdateError(): DrizzleQueryError {
  const cause = Object.assign(new Error('canceling statement due to statement timeout'), {
    code: '57014',
  });
  return new DrizzleQueryError(UPDATE_SQL, ['$argon2id$secret', 'u1'], cause);
}

/** 以正式的 pino-http 選項建立的 Pino（應用程式日誌與存取日誌共用的那一個）記一筆錯誤。 */
function logError(err: unknown): Record<string, unknown> {
  const lines: string[] = [];
  pinoHttp(pinoHttpOptions('production'), memoryStream(lines)).logger.error({ err }, 'boom');
  return JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
}

describe('錯誤的 serializer：資料庫錯誤不帶查詢參數（docs/conventions/03-backend.md §7）', () => {
  it('drizzle 的查詢錯誤：輸出找不到參數，SQL 本文與 cause.code 還在', () => {
    const entry = logError(passwordUpdateError());
    expect(JSON.stringify(entry)).not.toContain('secret');
    expect(entry.err).toMatchObject({
      type: 'DrizzleQueryError',
      message: `Failed query: ${UPDATE_SQL}`,
      query: UPDATE_SQL,
      cause: { code: '57014' },
    });
    expect(entry.err).not.toHaveProperty('params');
  });

  it('其他錯誤照 pino 的標準 serializer（type、message、stack 與自訂屬性）', () => {
    const entry = logError(Object.assign(new Error('smtp down'), { code: 'ECONNREFUSED' }));
    expect(entry.err).toMatchObject({
      type: 'Error',
      message: 'smtp down',
      code: 'ECONNREFUSED',
      stack: expect.stringContaining('smtp down'),
    });
  });

  it('沒經過 pino-http 包裝時（直接拿到原本的錯誤）結果相同', () => {
    expect(JSON.stringify(serializeError(passwordUpdateError()))).not.toContain('secret');
    const plain = new Error('boom');
    expect(serializeError(plain)).toEqual(stdSerializers.err(plain));
    expect(serializeError('not an error')).toBe('not an error');
  });
});

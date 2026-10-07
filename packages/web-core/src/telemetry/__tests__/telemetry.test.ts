import type { ErrorEvent, StreamedSpanJSON, TransactionEvent } from '@sentry/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { AbortReason, NetworkError, RequestAbortedError } from '../../client';
import { AppError } from '../../errors';
import {
  beforeBreadcrumb,
  beforeSendError,
  beforeSendSpan,
  beforeSendTransaction,
  bindTelemetryRouter,
  CHUNK_LOAD_FINGERPRINT,
  getTelemetryContext,
  isExpectedError,
  resetTelemetryStateForTest,
  resolveDsn,
} from '../telemetry';

function errorEvent(value = "Cannot read properties of undefined (reading 'id')"): ErrorEvent {
  return {
    type: undefined,
    exception: { values: [{ type: 'TypeError', value }] },
    user: { id: 'u-1', email: 'alice@example.com', ip_address: '1.2.3.4' },
    request: {
      url: `${globalThis.location.origin}/user/0f8fad5b-d9cb-469f-a165-70867728950e?tab=roles`,
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://acme.example.com/' },
      cookies: { refresh: 'x' },
    },
    extra: { form: { email: 'alice@example.com' } },
  };
}

beforeEach(() => {
  resetTelemetryStateForTest();
});

describe('resolveDsn（docs/architecture/frontend/19-observability.md §9.2 D2、D11）', () => {
  const location = { protocol: 'https:', host: 'acme.example.com' };

  it('以目前的網域組成同源的 DSN', () => {
    expect(resolveDsn({ projectId: '1', publicKey: 'abc' }, location)).toBe(
      'https://abc@acme.example.com/apm/1',
    );
  });

  it('完整的 DSN 優先（接真的 Sentry）', () => {
    expect(
      resolveDsn(
        { dsn: 'https://k@o0.ingest.sentry.io/9', projectId: '1', publicKey: 'abc' },
        location,
      ),
    ).toBe('https://k@o0.ingest.sentry.io/9');
  });

  it('沒有設定時是 undefined（只 console.debug）', () => {
    expect(resolveDsn({}, location)).toBeUndefined();
    expect(resolveDsn({ projectId: '1' }, location)).toBeUndefined();
  });
});

describe('isExpectedError（UI 處理、後端有紀錄的錯誤不上報）', () => {
  it.each([
    ['AppError', new AppError('ROLE_NOT_FOUND', 404)],
    ['NetworkError', new NetworkError(new TypeError('Failed to fetch'))],
    ['RequestAbortedError', new RequestAbortedError(AbortReason.TIMEOUT)],
  ])('%s 不上報', (_name, error) => {
    expect(isExpectedError(error)).toBe(true);
  });

  it('程式錯誤要上報', () => {
    expect(isExpectedError(new TypeError('x is not a function'))).toBe(false);
  });
});

describe('beforeSendError（docs/architecture/frontend/19-observability.md §9.2 D7、D8）', () => {
  it('使用者只留 id；同源的網址換成樣板；只留 User-Agent；丟掉 extra', () => {
    const event = beforeSendError(errorEvent(), {});
    expect(event?.user).toEqual({ id: 'u-1' });
    expect(event?.request).toEqual({ url: '/user/:id', headers: { 'User-Agent': 'Mozilla/5.0' } });
    expect(event?.extra).toBeUndefined();
  });

  it('錯誤訊息遮罩', () => {
    const event = beforeSendError(errorEvent('user alice@example.com not found'), {});
    expect(event?.exception?.values?.[0]?.value).toBe('user [email] not found');
  });

  it('chunk 載入失敗固定一組、等級是 warning', () => {
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/a.js');
    const event = beforeSendError(errorEvent(error.message), { originalException: error });
    expect(event?.fingerprint).toEqual([CHUNK_LOAD_FINGERPRINT]);
    expect(event?.level).toBe('warning');
    expect(event?.tags).toMatchObject({ kind: 'chunkLoad' });
  });

  it('同一個錯誤一分鐘內只送一次', () => {
    expect(beforeSendError(errorEvent(), {}, 0)).not.toBeNull();
    expect(beforeSendError(errorEvent(), {}, 30_000)).toBeNull();
    expect(beforeSendError(errorEvent(), {}, 61_000)).not.toBeNull();
  });

  it('同一個分頁最多送 50 個', () => {
    for (let index = 0; index < 50; index += 1) {
      expect(beforeSendError(errorEvent(`error ${index}`), {})).not.toBeNull();
    }
    expect(beforeSendError(errorEvent('one more'), {})).toBeNull();
  });
});

describe('beforeSendTransaction', () => {
  it('網址換成樣板、span 的描述遮罩', () => {
    const event = beforeSendTransaction({
      type: 'transaction',
      request: { url: `${globalThis.location.origin}/user/42?tab=a` },
      spans: [
        {
          description: 'GET https://acme.example.com/api/users?email=a@b.co',
          span_id: '1',
          trace_id: '1',
          start_timestamp: 0,
          data: {},
          origin: 'manual',
        },
      ],
    } as TransactionEvent);
    expect(event.request).toEqual({ url: '/user/:id' });
    expect(event.spans?.[0]?.description).toBe('GET https://acme.example.com/api/users');
  });
});

describe('beforeBreadcrumb', () => {
  it('只留網路請求、導覽與推播', () => {
    expect(beforeBreadcrumb({ category: 'ui.click', message: 'button "Delete alice"' })).toBeNull();
    expect(beforeBreadcrumb({ category: 'console', message: 'x' })).toBeNull();
    expect(beforeBreadcrumb({ category: 'realtime', message: '推播連線失敗' })).toEqual({
      category: 'realtime',
      message: '推播連線失敗',
    });
  });

  it('fetch：網址換成樣板、補上 requestId、只留 method 與狀態', () => {
    const crumb = beforeBreadcrumb(
      {
        category: 'fetch',
        data: {
          method: 'GET',
          url: '/api/users/42?email=a',
          status_code: 500,
          request_body_size: 10,
        },
      },
      { response: new Response(null, { status: 500, headers: { 'x-request-id': 'req-1' } }) },
    );
    expect(crumb?.data).toEqual({
      method: 'GET',
      url: '/api/users/:id',
      status_code: 500,
      requestId: 'req-1',
    });
  });

  it('上報本身的請求不記', () => {
    expect(
      beforeBreadcrumb({ category: 'fetch', data: { url: '/apm/api/1/envelope/?sentry_key=k' } }),
    ).toBeNull();
  });
});

describe('bindTelemetryRouter（頁面的 path 樣板）', () => {
  function fakeRouter() {
    let listener: ((event: unknown) => void) | undefined;
    const router = {
      state: { location: { pathname: '/user/42' } },
      matchRoutes: (pathname: string) => [
        { fullPath: '/' },
        { fullPath: pathname.startsWith('/user/') ? '/user/$userId' : pathname },
      ],
      subscribe: (_type: string, fn: (event: unknown) => void) => {
        listener = fn;
        return () => undefined;
      },
    };
    return {
      router: router as unknown as Parameters<typeof bindTelemetryRouter>[0],
      emit: (event: unknown) => listener?.(event),
    };
  }

  it('以樣板當頁面；換頁時更新，第一次載入不算換頁', () => {
    const { router, emit } = fakeRouter();
    bindTelemetryRouter(router);
    expect(getTelemetryContext().route).toBe('/user/$userId');

    emit({
      pathChanged: true,
      fromLocation: undefined,
      toLocation: { pathname: '/role', href: '/role' },
    });
    expect(getTelemetryContext().route).toBe('/user/$userId');

    emit({
      pathChanged: true,
      fromLocation: { pathname: '/user/42' },
      toLocation: { pathname: '/role', href: '/role' },
    });
    expect(getTelemetryContext().route).toBe('/role');
  });
});

describe('beforeSendSpan（v11 的 span streaming）', () => {
  function span(name: string, attributes: Record<string, unknown>): StreamedSpanJSON {
    return {
      name,
      attributes,
      trace_id: 't',
      span_id: 's',
      start_timestamp: 0,
      status: 'ok',
      is_segment: false,
    } as StreamedSpanJSON;
  }

  it('只留 Web Vitals 用得到的屬性；元素選擇器、資源網址、User-Agent 丟掉；名稱換成頁面', () => {
    const result = beforeSendSpan(
      span('body > div.user-card[aria-label="Alice Chen"]', {
        'browser.web_vital.inp.value': 180,
        'browser.web_vital.inp.target': 'button[aria-label="刪除 Alice"]',
        'sentry.segment.name': '/user/$userId',
        'sentry.op': 'ui.interaction.click',
        'user_agent.original': 'Mozilla/5.0',
      }),
    );
    expect(result.name).toBe('/user/$userId');
    expect(result.attributes).toEqual({
      'browser.web_vital.inp.value': 180,
      'sentry.segment.name': '/user/$userId',
      'sentry.op': 'ui.interaction.click',
    });
  });

  it('LCP 等頁面載入的指標歸回第一頁（SDK 換頁時才回報，會掛上下一頁）', () => {
    const { router, emit } = (() => {
      let listener: ((event: unknown) => void) | undefined;
      return {
        router: {
          state: { location: { pathname: '/' } },
          matchRoutes: (pathname: string) => [{ fullPath: pathname }],
          subscribe: (_type: string, fn: (event: unknown) => void) => {
            listener = fn;
            return () => undefined;
          },
        } as unknown as Parameters<typeof bindTelemetryRouter>[0],
        emit: (event: unknown) => listener?.(event),
      };
    })();
    bindTelemetryRouter(router);
    emit({
      pathChanged: true,
      fromLocation: { pathname: '/' },
      toLocation: { pathname: '/role', href: '/role' },
    });

    const lcp = beforeSendSpan(
      span('img.hero', {
        'browser.web_vital.lcp.value': 900,
        'browser.web_vital.lcp.url': 'https://cdn.example.com/a.png?sig=x',
        'sentry.segment.name': '/role',
      }),
    );
    expect(lcp.attributes['sentry.segment.name']).toBe('/');
    expect(lcp.name).toBe('/');
    expect(lcp.attributes).not.toHaveProperty('browser.web_vital.lcp.url');

    const inp = beforeSendSpan(
      span('button', { 'browser.web_vital.inp.value': 50, 'sentry.segment.name': '/role' }),
    );
    expect(inp.attributes['sentry.segment.name']).toBe('/role');
  });
});

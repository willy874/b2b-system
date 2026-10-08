import { addBreadcrumb, captureException, getClient, init, setTag, setUser } from '@sentry/browser';
import type * as SentryBrowser from '@sentry/browser';
import type { ErrorEvent, StreamedSpanJSON, TransactionEvent } from '@sentry/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbortReason, NetworkError, RequestAbortedError } from '../../client';
import { AppError } from '../../errors';
import { scrubText } from '../scrub';
import {
  beforeBreadcrumb,
  beforeSendError,
  beforeSendSpan,
  beforeSendTransaction,
  bindTelemetryRouter,
  captureError,
  CHUNK_LOAD_FINGERPRINT,
  getTelemetryContext,
  initTelemetry,
  isExpectedError,
  resetTelemetryStateForTest,
  resolveDsn,
  addTelemetryBreadcrumb,
  setTelemetryUser,
  telemetryRootOptions,
} from '../telemetry';

// SDK 的全域副作用（init、上報）換成假的：只驗證這裡交給 SDK 的內容；事件處理的純函式仍用真的
vi.mock('@sentry/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof SentryBrowser>()),
  init: vi.fn(),
  captureException: vi.fn(() => 'event-1'),
  lastEventId: vi.fn(() => 'event-1'),
  setUser: vi.fn(),
  setTag: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

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

describe('initTelemetry({ enabled: false })（APM 整套關閉，docs/architecture/frontend/19-observability.md §8）', () => {
  it('不初始化 SDK：沒有 client，上報是空操作', () => {
    initTelemetry({
      enabled: false,
      app: 'backstage',
      release: 'r1',
      environment: 'production',
      projectId: '1',
      publicKey: 'b2bsystemdevbackstage0000',
    });
    expect(getClient()).toBeUndefined();
    expect(captureError(new Error('boom'), 'manual')).toBeUndefined();
    expect(getTelemetryContext().eventId).toBeUndefined();
  });
});

describe('initTelemetry（初始化 SDK，docs/architecture/frontend/19-observability.md）', () => {
  const base = { app: 'backstage', release: 'r1', environment: 'production' };
  type InitOptions = NonNullable<Parameters<typeof init>[0]>;
  const initOptions = () => vi.mocked(init).mock.calls.at(-1)?.[0] as InitOptions;

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('沒有 DSN：給一個不連線的 DSN 與印到 console 的 transport，不取樣 Web Vitals', () => {
    initTelemetry(base);

    expect(initOptions()).toMatchObject({
      dsn: 'http://dev@localhost/0',
      release: 'r1',
      environment: 'production',
      defaultIntegrations: false,
      tracesSampleRate: 0,
      tracePropagationTargets: [],
      initialScope: { tags: { app: 'backstage' } },
    });
    expect(initOptions().transport).toEqual(expect.any(Function));
    expect(getTelemetryContext()).toEqual({ eventId: 'event-1', release: 'r1', route: undefined });
  });

  it('有 DSN：送到同源的 apm-service，Web Vitals 預設取樣 0.1；可以覆寫', () => {
    initTelemetry({ ...base, projectId: '1', publicKey: 'abc' });
    expect(initOptions()).toMatchObject({
      dsn: `${globalThis.location.protocol}//abc@${globalThis.location.host}/apm/1`,
      tracesSampleRate: 0.1,
    });
    expect(initOptions().transport).toBeUndefined();

    resetTelemetryStateForTest();
    initTelemetry({ ...base, dsn: 'https://k@sentry.example.com/9', tracesSampleRate: 0.5 });
    expect(initOptions()).toMatchObject({
      dsn: 'https://k@sentry.example.com/9',
      tracesSampleRate: 0.5,
    });
  });

  it('只初始化一次', () => {
    initTelemetry(base);
    initTelemetry({ ...base, release: 'r2' });

    expect(init).toHaveBeenCalledTimes(1);
    expect(getTelemetryContext().release).toBe('r1');
  });

  it('SDK 的 beforeSend 交給 beforeSendError（遮罩、只留使用者 id）', () => {
    initTelemetry(base);

    const sent = initOptions().beforeSend?.(errorEvent(), {}) as ErrorEvent;

    expect(sent.user).toEqual({ id: 'u-1' });
  });

  it('captureError 帶上來源與是否已處理，回傳事件 id', () => {
    const error = new Error('boom');
    expect(captureError(error, 'manual')).toBeUndefined();
    expect(captureException).not.toHaveBeenCalled();

    initTelemetry(base);

    expect(captureError(error, 'worker', false)).toBe('event-1');
    expect(captureException).toHaveBeenCalledWith(error, {
      captureContext: { tags: { source: 'worker' } },
      mechanism: { type: 'worker', handled: false },
    });
  });

  it('setTelemetryUser 只帶 id；登出時清掉；未初始化時不做事', () => {
    setTelemetryUser('u-1');
    expect(setUser).not.toHaveBeenCalled();

    initTelemetry(base);
    setTelemetryUser('u-1');
    setTelemetryUser(undefined);

    expect(vi.mocked(setUser).mock.calls).toEqual([[{ id: 'u-1' }], [null]]);
  });

  it('addTelemetryBreadcrumb 遮罩訊息；未初始化時不做事', () => {
    addTelemetryBreadcrumb('realtime', 'x');
    expect(addBreadcrumb).not.toHaveBeenCalled();

    initTelemetry(base);
    const message = '連線中斷 alice@example.com';
    addTelemetryBreadcrumb('realtime', message, { reason: 'timeout' });
    addTelemetryBreadcrumb('navigation', 'go');

    expect(vi.mocked(addBreadcrumb).mock.calls).toEqual([
      [{ category: 'realtime', message: scrubText(message, 200), data: { reason: 'timeout' } }],
      [{ category: 'navigation', message: 'go' }],
    ]);
  });

  it('初始化後換頁：設定 route tag、加導覽的 breadcrumb；同一個目的地只算一次', () => {
    initTelemetry(base);
    let listener: ((event: unknown) => void) | undefined;
    const router = {
      state: { location: { pathname: '/' } },
      matchRoutes: (pathname: string) => [{ fullPath: pathname }],
      subscribe: (_type: string, fn: (event: unknown) => void) => {
        listener = fn;
        return () => undefined;
      },
    } as unknown as Parameters<typeof bindTelemetryRouter>[0];
    bindTelemetryRouter(router);
    const navigate = {
      pathChanged: true,
      fromLocation: { pathname: '/' },
      toLocation: { pathname: '/role', href: '/role' },
    };

    listener?.(navigate);
    listener?.(navigate);
    listener?.({ ...navigate, pathChanged: false });

    expect(setTag).toHaveBeenLastCalledWith('route', '/role');
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(addBreadcrumb).toHaveBeenCalledWith({
      category: 'navigation',
      data: { from: '/', to: '/role' },
    });
  });
});

describe('telemetryRootOptions（交給 createRoot 的錯誤回呼）', () => {
  beforeEach(() => {
    initTelemetry({ app: 'backstage', release: 'r1', environment: 'test' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('未捕捉的錯誤標為未處理，並保留 console 輸出', () => {
    const error = new Error('uncaught');
    telemetryRootOptions().onUncaughtError(error);

    expect(captureException).toHaveBeenCalledWith(error, {
      captureContext: { tags: { source: 'react' } },
      mechanism: { type: 'react', handled: false },
    });
    expect(console.error).toHaveBeenCalledWith(error);
  });

  it('錯誤邊界接住的錯誤與可復原的錯誤標為已處理；可復原的不印 console', () => {
    const options = telemetryRootOptions();
    options.onCaughtError(new Error('caught'));
    options.onRecoverableError(new Error('recoverable'));

    const handled = vi
      .mocked(captureException)
      .mock.calls.map(
        ([, hint]) => (hint as { mechanism: { handled: boolean } }).mechanism.handled,
      );
    expect(handled).toEqual([true, true]);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

import { computeGroupId, normalizeMessage } from '../fingerprint';
import { normalizeEvent } from '../normalize';

const NOW = new Date('2026-10-07T06:00:00.000Z');

function sentryEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: '0123456789abcdef0123456789abcdef',
    timestamp: 1_791_352_800.5,
    platform: 'javascript',
    level: 'error',
    release: '1a2b3c4',
    environment: 'production',
    transaction: '/user/$userId',
    exception: {
      values: [
        {
          type: 'TypeError',
          value: "Cannot read properties of undefined (reading 'id')",
          mechanism: { type: 'onerror', handled: false },
          stacktrace: {
            frames: [
              {
                filename: 'https://acme.example.com/assets/vendor-1.js',
                function: 'r',
                lineno: 1,
                colno: 10,
                in_app: false,
              },
              {
                filename: 'https://acme.example.com/assets/index-2.js?v=1',
                function: 'a',
                lineno: 3,
                colno: 99,
                in_app: true,
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      {
        timestamp: 1_791_352_799,
        category: 'fetch',
        type: 'http',
        data: {
          method: 'GET',
          url: '/api/users?email=a@b.co',
          status_code: 500,
          requestId: 'r1',
          body: 'secret',
        },
      },
    ],
    tags: { tenant: 'acme', source: 'react' },
    user: { id: 'u-1', email: 'alice@example.com', ip_address: '1.2.3.4' },
    request: {
      url: 'https://acme.example.com/user/1?tab=roles',
      headers: { 'User-Agent': 'Mozilla/5.0', Cookie: 'refresh=x' },
      cookies: { refresh: 'x' },
    },
    extra: { password: 'x' },
    contexts: { state: { form: 'x' } },
    sdk: { name: 'sentry.javascript.browser', version: '11.4.0' },
    ...overrides,
  };
}

describe('normalizeEvent（Sentry 事件 → 存檔格式）', () => {
  it('保留錯誤、堆疊、release、頁面與 breadcrumb', () => {
    const event = normalizeEvent(sentryEvent(), 'backstage', NOW);
    expect(event).toMatchObject({
      eventId: '0123456789abcdef0123456789abcdef',
      project: 'backstage',
      title: "TypeError: Cannot read properties of undefined (reading 'id')",
      culprit: 'a(/assets/index-2.js)',
      level: 'error',
      release: '1a2b3c4',
      transaction: '/user/$userId',
      receivedAt: NOW.toISOString(),
      tags: { tenant: 'acme', source: 'react' },
      sdk: { name: 'sentry.javascript.browser', version: '11.4.0' },
    });
    expect(event.exceptions[0]?.frames[1]).toEqual({
      filename: 'https://acme.example.com/assets/index-2.js',
      function: 'a',
      lineno: 3,
      colno: 99,
      in_app: true,
    });
  });

  it('使用者只留 id；丟掉 headers、cookies、extra、contexts（設計決策 D7）', () => {
    const event = normalizeEvent(sentryEvent(), 'backstage', NOW);
    expect(event.user).toEqual({ id: 'u-1' });
    expect(event.userAgent).toBe('Mozilla/5.0');
    expect(event.url).toBe('https://acme.example.com/user/1');
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('alice@example.com');
    expect(serialized).not.toContain('1.2.3.4');
    expect(serialized).not.toContain('refresh');
    expect(serialized).not.toContain('password');
  });

  it('breadcrumb 的 data 只留允許的欄位，網址去掉 query', () => {
    const event = normalizeEvent(sentryEvent(), 'backstage', NOW);
    expect(event.breadcrumbs[0]?.data).toEqual({
      method: 'GET',
      url: '/api/users',
      status_code: 500,
      requestId: 'r1',
    });
  });

  it('event_id 不合法時另外產生', () => {
    const event = normalizeEvent(sentryEvent({ event_id: 'nope' }), 'backstage', NOW);
    expect(event.eventId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('沒有例外時以 message 當標題', () => {
    const event = normalizeEvent(
      sentryEvent({ exception: undefined, message: 'manual report' }),
      'backstage',
      NOW,
    );
    expect(event.title).toBe('manual report');
    expect(event.exceptions).toEqual([]);
  });

  it('不認得的 level 一律當 error', () => {
    expect(normalizeEvent(sentryEvent({ level: 'panic' }), 'backstage', NOW).level).toBe('error');
  });
});

describe('fingerprint（設計決策 D8）', () => {
  it('訊息裡會變的部分換成佔位', () => {
    expect(normalizeMessage('user 0f8fad5b-d9cb-469f-a165-70867728950e not found at 12')).toBe(
      'user <uuid> not found at <n>',
    );
    expect(normalizeMessage(`Cannot read properties of undefined (reading 'id')`)).toBe(
      'Cannot read properties of undefined (reading <str>)',
    );
  });

  it('同類型、同訊息形狀的錯誤分在同一組，不分 release', () => {
    const a = normalizeEvent(sentryEvent({ release: 'a' }), 'backstage', NOW);
    const b = normalizeEvent(sentryEvent({ release: 'b' }), 'backstage', NOW);
    expect(a.groupId).toBe(b.groupId);
  });

  it('不同專案分開', () => {
    const input = { custom: undefined, type: 'Error', value: 'x' };
    expect(computeGroupId({ project: 'backstage', ...input })).not.toBe(
      computeGroupId({ project: 'platform', ...input }),
    );
  });

  it('SDK 指定 fingerprint 時用它；{{ default }} 代表預設分組', () => {
    const chunkA = normalizeEvent(sentryEvent({ fingerprint: ['chunk-load'] }), 'backstage', NOW);
    const chunkB = normalizeEvent(
      sentryEvent({
        fingerprint: ['chunk-load'],
        exception: { values: [{ type: 'X', value: 'y' }] },
      }),
      'backstage',
      NOW,
    );
    expect(chunkA.groupId).toBe(chunkB.groupId);
    const withDefault = normalizeEvent(
      sentryEvent({ fingerprint: ['{{ default }}'] }),
      'backstage',
      NOW,
    );
    expect(withDefault.groupId).toBe(normalizeEvent(sentryEvent(), 'backstage', NOW).groupId);
  });
});

import { vitalsFromSpanItem, vitalsFromTransaction } from '../vitals';

describe('Web Vitals 的取出（設計決策 D10）', () => {
  it('transaction 的 measurements', () => {
    expect(
      vitalsFromTransaction({
        transaction: '/user',
        measurements: { lcp: { value: 1200, unit: 'millisecond' }, fp: { value: 1 } },
        contexts: { trace: { op: 'pageload' } },
      }),
    ).toEqual([{ route: '/user', name: 'lcp', value: 1200 }]);
  });

  it('transaction 裡 span 的 browser.web_vital.*.value 屬性', () => {
    expect(
      vitalsFromTransaction({
        transaction: '/user',
        spans: [{ data: { 'browser.web_vital.cls.value': 0.12 } }],
      }),
    ).toEqual([{ route: '/user', name: 'cls', value: 0.12 }]);
  });

  it('navigation 的起訖時間差當成路由切換耗時', () => {
    expect(
      vitalsFromTransaction({
        transaction: '/role',
        start_timestamp: 100,
        timestamp: 100.25,
        contexts: { trace: { op: 'navigation' } },
      }),
    ).toEqual([{ route: '/role', name: 'navigation', value: 250 }]);
  });

  it('獨立的 span：route 取 sentry.segment.name', () => {
    expect(
      vitalsFromSpanItem({
        data: { 'browser.web_vital.inp.value': 180, 'sentry.segment.name': '/user/$userId' },
      }),
    ).toEqual([{ route: '/user/$userId', name: 'inp', value: 180 }]);
  });

  it('span streaming 的 { items } 與 { value, type } 屬性', () => {
    expect(
      vitalsFromSpanItem({
        items: [
          {
            attributes: {
              'browser.web_vital.lcp.value': { value: 900, type: 'double' },
              'sentry.segment.name': { value: '/home', type: 'string' },
            },
          },
        ],
      }),
    ).toEqual([{ route: '/home', name: 'lcp', value: 900 }]);
  });
});

import { ApmMetrics, OTHER_RELEASE, OTHER_ROUTE, UNKNOWN_RELEASE } from '../apm-metrics';

describe('ApmMetrics（/metrics，docs/architecture/frontend/19-observability.md §9.2 D10）', () => {
  it('Web Vital 以 histogram 輸出（累計的 bucket）', () => {
    const metrics = new ApmMetrics(10);
    metrics.observeVital('backstage', '/user', 'lcp', 300);
    metrics.observeVital('backstage', '/user', 'lcp', 3000);
    const text = metrics.render();
    expect(text).toContain(
      'apm_web_vital_bucket{project="backstage",route="/user",name="lcp",le="250"} 0',
    );
    expect(text).toContain(
      'apm_web_vital_bucket{project="backstage",route="/user",name="lcp",le="500"} 1',
    );
    expect(text).toContain(
      'apm_web_vital_bucket{project="backstage",route="/user",name="lcp",le="4000"} 2',
    );
    expect(text).toContain(
      'apm_web_vital_bucket{project="backstage",route="/user",name="lcp",le="+Inf"} 2',
    );
    expect(text).toContain('apm_web_vital_sum{project="backstage",route="/user",name="lcp"} 3300');
    expect(text).toContain('apm_web_vital_count{project="backstage",route="/user",name="lcp"} 2');
  });

  it('route 種類超過上限之後歸到 other；格式不對的也是', () => {
    const metrics = new ApmMetrics(1);
    metrics.observeVital('backstage', '/a', 'inp', 10);
    metrics.observeVital('backstage', '/b', 'inp', 10);
    metrics.observeVital('backstage', 'bad route"}', 'inp', 10);
    const text = metrics.render();
    expect(text).toContain('route="/a"');
    expect(text).not.toContain('route="/b"');
    expect(text).toContain(`route="${OTHER_ROUTE}",name="inp",le="+Inf"} 2`);
  });

  it('略過負數與非數字', () => {
    const metrics = new ApmMetrics(10);
    metrics.observeVital('backstage', '/a', 'cls', -1);
    metrics.observeVital('backstage', '/a', 'cls', Number.NaN);
    expect(metrics.render()).not.toContain('route="/a"');
  });

  it('錯誤事件依專案、等級、release 計數', () => {
    const metrics = new ApmMetrics(10, 5);
    metrics.countEvent('backstage', 'error', '1a2b3c4');
    metrics.countEvent('backstage', 'error', '1a2b3c4');
    metrics.countEvent('backstage', 'warning', undefined);
    metrics.countEvent('platform', 'nonsense', 'bad release"}');
    const text = metrics.render();
    expect(text).toContain(
      'apm_events_total{project="backstage",level="error",release="1a2b3c4"} 2',
    );
    expect(text).toContain(
      `apm_events_total{project="backstage",level="warning",release="${UNKNOWN_RELEASE}"} 1`,
    );
    expect(text).toContain(
      `apm_events_total{project="platform",level="error",release="${OTHER_RELEASE}"} 1`,
    );
  });

  it('release 只保留每個專案最近的幾個，被淘汰的連同時間序列一起刪掉（docs/architecture/08-monitoring.md §5.1）', () => {
    const metrics = new ApmMetrics(10, 2);
    metrics.countEvent('backstage', 'error', 'r1');
    metrics.countEvent('backstage', 'error', 'r2');
    metrics.countEvent('backstage', 'error', 'r1');
    metrics.countEvent('backstage', 'error', 'r3');
    metrics.countEvent('platform', 'error', 'r2');
    const text = metrics.render();
    // r1 剛出現過，比 r2 新：淘汰的是 r2
    expect(text).toContain('apm_events_total{project="backstage",level="error",release="r1"} 2');
    expect(text).toContain('apm_events_total{project="backstage",level="error",release="r3"} 1');
    expect(text).not.toContain('project="backstage",level="error",release="r2"');
    // 每個專案各自計算
    expect(text).toContain('apm_events_total{project="platform",level="error",release="r2"} 1');
  });
});

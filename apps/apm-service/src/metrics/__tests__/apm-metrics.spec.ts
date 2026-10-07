import { ApmMetrics, OTHER_ROUTE } from '../apm-metrics';

describe('ApmMetrics（/metrics，設計決策 D10）', () => {
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
});

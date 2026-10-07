/**
 * 最小的 Prometheus 指標（文字格式 0.0.4）。只有 counter 與 histogram，服務不值得為此引入 prom-client。
 */

type Labels = Readonly<Record<string, string>>;

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}

function formatLabels(labels: Labels, extra?: Labels): string {
  const entries = Object.entries({ ...labels, ...extra });
  if (entries.length === 0) return '';
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')}}`;
}

function labelKey(labels: Labels): string {
  return JSON.stringify(Object.entries(labels).toSorted(([a], [b]) => a.localeCompare(b)));
}

export class Counter {
  private readonly values = new Map<string, { labels: Labels; value: number }>();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, amount = 1): void {
    const key = labelKey(labels);
    const entry = this.values.get(key);
    if (entry) entry.value += amount;
    else this.values.set(key, { labels, value: amount });
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${formatLabels(labels)} ${value}`);
    }
    return lines.join('\n');
  }
}

interface HistogramSeries {
  labels: Labels;
  buckets: number[];
  sum: number;
  count: number;
}

export class Histogram {
  private readonly series = new Map<string, HistogramSeries>();

  /** @param bucketsFor 依標籤決定邊界（不同的 Web Vital 單位不同）。 */
  constructor(
    readonly name: string,
    readonly help: string,
    private readonly bucketsFor: (labels: Labels) => readonly number[],
  ) {}

  observe(labels: Labels, value: number): void {
    const key = labelKey(labels);
    let series = this.series.get(key);
    if (!series) {
      series = { labels, buckets: this.bucketsFor(labels).map(() => 0), sum: 0, count: 0 };
      this.series.set(key, series);
    }
    const bounds = this.bucketsFor(labels);
    bounds.forEach((bound, index) => {
      if (value <= bound && series) series.buckets[index] = (series.buckets[index] ?? 0) + 1;
    });
    series.sum += value;
    series.count += 1;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const { labels, buckets, sum, count } of this.series.values()) {
      this.bucketsFor(labels).forEach((bound, index) => {
        lines.push(
          `${this.name}_bucket${formatLabels(labels, { le: String(bound) })} ${buckets[index] ?? 0}`,
        );
      });
      lines.push(`${this.name}_bucket${formatLabels(labels, { le: '+Inf' })} ${count}`);
      lines.push(`${this.name}_sum${formatLabels(labels)} ${sum}`);
      lines.push(`${this.name}_count${formatLabels(labels)} ${count}`);
    }
    return lines.join('\n');
  }
}

import type { ApmConfig } from '@/config';
import type { ApmServices } from '@/context';
import { RateLimiter } from '@/ingest/rate-limit';
import { ApmMetrics } from '@/metrics/apm-metrics';
import { SourcemapStore } from '@/sourcemaps/sourcemap-store';
import { Symbolicator } from '@/sourcemaps/symbolicate';
import { EventStore } from '@/store/event-store';

export async function createServices(
  config: ApmConfig,
  now: () => Date = () => new Date(),
): Promise<ApmServices> {
  const events = await EventStore.open(config.dataDir);
  const sourcemaps = await SourcemapStore.open(config.dataDir);
  return {
    config,
    events,
    sourcemaps,
    symbolicator: new Symbolicator(sourcemaps),
    metrics: new ApmMetrics(config.routeLabelLimit, config.releaseLabelLimit),
    rateLimiter: new RateLimiter(config.rateLimitPerMinute),
    now,
  };
}

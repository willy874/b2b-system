import { clientIp, header, type RequestContext } from '@/context';
import { parseEnvelope, parseItemJson } from '@/envelope/parse';
import { readBody } from '@/http/body';
import { ApmError } from '@/http/errors';
import { sendJson } from '@/http/respond';
import { authenticateIngest } from '@/ingest/auth';
import { normalizeEvent } from '@/ingest/normalize';
import { vitalsFromSpanItem, vitalsFromTransaction } from '@/ingest/vitals';
import { log } from '@/log';

/**
 * `POST /api/:projectId/envelope/`：SDK 的收件端點（Sentry 相容，設計決策 D3）。
 *
 * - `event`：遮罩後存檔，並寫一行日誌（設計決策 D6）
 * - `transaction`、`span`：取出 Web Vitals 記進 `/metrics`，本身不存
 * - 其他（`session`、`client_report`、`attachment`…）：接受後丟棄
 */
export async function ingestEnvelope(context: RequestContext): Promise<void> {
  const { req, res, url, params, services } = context;
  const { config, metrics } = services;
  const projectId = params.projectId ?? '';

  const retryAfter = services.rateLimiter.hit(`${clientIp(req, config.trustProxy)}\n${projectId}`);
  if (retryAfter !== undefined) {
    metrics.envelopes.inc({ result: 'rate_limited' });
    // `<秒數>::organization`：SDK 對所有類別暫停送出
    throw new ApmError(429, '送出太頻繁，請稍後再試', {
      'Retry-After': String(retryAfter),
      'X-Sentry-Rate-Limits': `${retryAfter}::organization`,
    });
  }

  let envelope;
  try {
    envelope = parseEnvelope(await readBody(req, config.maxEnvelopeBytes));
  } catch (error) {
    metrics.envelopes.inc({ result: 'invalid' });
    throw error;
  }
  let project;
  try {
    project = authenticateIngest(config.projects, projectId, {
      query: url.searchParams,
      authHeader: header(req, 'x-sentry-auth'),
      envelopeDsn: envelope.header.dsn,
    });
  } catch (error) {
    metrics.envelopes.inc({ result: 'unauthorized' });
    throw error;
  }

  let eventId = typeof envelope.header.event_id === 'string' ? envelope.header.event_id : undefined;
  for (const item of envelope.items) {
    const type = item.header.type;
    metrics.items.inc({ project: project.slug, type: KNOWN_ITEM_TYPES.has(type) ? type : 'other' });
    if (type !== 'event' && type !== 'transaction' && type !== 'span') continue;
    const payload = parseItemJson(item);
    if (!payload) continue;

    if (type === 'event') {
      const event = normalizeEvent(payload, project.slug, services.now());
      eventId = event.eventId;
      // oxlint-disable-next-line no-await-in-loop -- 一個 envelope 只有一個事件
      await services.events.append(event);
      log.warn('client error', {
        project: event.project,
        eventId: event.eventId,
        groupId: event.groupId,
        title: event.title,
        release: event.release,
        transaction: event.transaction,
        userId: event.user?.id,
        tenant: event.tags.tenant,
      });
      continue;
    }
    const samples =
      type === 'transaction' ? vitalsFromTransaction(payload) : vitalsFromSpanItem(payload);
    for (const sample of samples) {
      metrics.observeVital(project.slug, sample.route, sample.name, sample.value);
    }
  }

  metrics.envelopes.inc({ result: 'accepted' });
  sendJson(res, 200, eventId === undefined ? {} : { id: eventId });
}

/** `/metrics` 的 `type` 標籤只用這些值，其餘歸 `other`（客戶端可以送任意字串）。 */
const KNOWN_ITEM_TYPES = new Set([
  'event',
  'transaction',
  'span',
  'session',
  'sessions',
  'client_report',
  'attachment',
  'profile',
  'replay_event',
  'replay_recording',
  'feedback',
  'log',
  'trace_metric',
]);

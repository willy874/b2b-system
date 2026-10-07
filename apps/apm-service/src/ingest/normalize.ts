import { randomUUID } from 'node:crypto';

import type { StoredBreadcrumb, StoredEvent, StoredException, StoredFrame } from '@/store/types';

import { computeGroupId } from './fingerprint';
import { asString, scrubText, scrubUrl } from './scrub';

const MAX_EXCEPTIONS = 5;
const MAX_FRAMES = 100;
const MAX_BREADCRUMBS = 50;
const MAX_TAGS = 50;
const MAX_VALUE_LENGTH = 1000;
const MAX_SHORT_LENGTH = 200;
/** breadcrumb 的 `data` 只留這些欄位（fetch 的 method／狀態、導覽的頁面、後端的 requestId）。 */
const BREADCRUMB_DATA_KEYS = new Set([
  'method',
  'status_code',
  'url',
  'from',
  'to',
  'route',
  'requestId',
  'reason',
]);
const LEVELS = new Set(['fatal', 'error', 'warning', 'info', 'debug']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** SDK 的時間是 Unix 秒數（可有小數）或 ISO 字串。 */
function toIsoTime(value: unknown, fallback: Date): string {
  if (typeof value === 'number' && Number.isFinite(value))
    return new Date(value * 1000).toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback.toISOString();
}

/** 堆疊裡的檔名只去掉 query string：不套用長字串的遮罩，否則壓縮後的檔名可能被誤遮。 */
function frameFilename(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cut = value.search(/[?#]/);
  return (cut === -1 ? value : value.slice(0, cut)).slice(0, 500);
}

function normalizeFrame(raw: unknown): StoredFrame | undefined {
  if (!isRecord(raw)) return undefined;
  const frame: StoredFrame = {};
  const filename = frameFilename(raw.filename);
  const absPath = frameFilename(raw.abs_path);
  const fn = typeof raw.function === 'string' ? raw.function.slice(0, MAX_SHORT_LENGTH) : undefined;
  const lineno = asNumber(raw.lineno);
  const colno = asNumber(raw.colno);
  if (filename !== undefined) frame.filename = filename;
  if (absPath !== undefined) frame.abs_path = absPath;
  if (fn !== undefined) frame.function = fn;
  if (lineno !== undefined) frame.lineno = lineno;
  if (colno !== undefined) frame.colno = colno;
  if (typeof raw.in_app === 'boolean') frame.in_app = raw.in_app;
  return frame;
}

function normalizeException(raw: unknown): StoredException | undefined {
  if (!isRecord(raw)) return undefined;
  const stacktrace = isRecord(raw.stacktrace) ? raw.stacktrace : undefined;
  const rawFrames = Array.isArray(stacktrace?.frames) ? stacktrace.frames : [];
  // 保留最內層的那幾層：Sentry 的順序是由外而內
  const frames = rawFrames
    .slice(-MAX_FRAMES)
    .map(normalizeFrame)
    .filter((frame): frame is StoredFrame => frame !== undefined);
  const exception: StoredException = {
    type: asString(raw.type, MAX_SHORT_LENGTH) ?? 'Error',
    value: asString(raw.value, MAX_VALUE_LENGTH) ?? '',
    frames,
  };
  if (isRecord(raw.mechanism)) {
    const mechanism: StoredException['mechanism'] = {};
    const type = asString(raw.mechanism.type, MAX_SHORT_LENGTH);
    if (type !== undefined) mechanism.type = type;
    if (typeof raw.mechanism.handled === 'boolean') mechanism.handled = raw.mechanism.handled;
    exception.mechanism = mechanism;
  }
  return exception;
}

function normalizeBreadcrumb(raw: unknown): StoredBreadcrumb | undefined {
  if (!isRecord(raw)) return undefined;
  const crumb: StoredBreadcrumb = {};
  const timestamp = asNumber(raw.timestamp);
  if (timestamp !== undefined) crumb.timestamp = timestamp;
  for (const key of ['category', 'type', 'level'] as const) {
    const value = asString(raw[key], 50);
    if (value !== undefined) crumb[key] = value;
  }
  const message = asString(raw.message, MAX_SHORT_LENGTH);
  if (message !== undefined) crumb.message = message;
  if (isRecord(raw.data)) {
    const data: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(raw.data)) {
      if (!BREADCRUMB_DATA_KEYS.has(key)) continue;
      if (typeof value === 'number' || typeof value === 'boolean') data[key] = value;
      else if (typeof value === 'string') {
        data[key] = key === 'url' ? scrubUrl(value) : scrubText(value, MAX_SHORT_LENGTH);
      }
    }
    if (Object.keys(data).length > 0) crumb.data = data;
  }
  return crumb;
}

/** v7 以前的 SDK 送 `{ values: [...] }`，之後送陣列。 */
function breadcrumbList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw) && Array.isArray(raw.values)) return raw.values;
  return [];
}

function exceptionList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw) && Array.isArray(raw.values)) return raw.values;
  return [];
}

function messageOf(raw: unknown): string | undefined {
  if (typeof raw === 'string') return scrubText(raw, MAX_VALUE_LENGTH);
  if (isRecord(raw)) return asString(raw.formatted ?? raw.message, MAX_VALUE_LENGTH);
  return undefined;
}

function normalizeTags(raw: unknown): Record<string, string> {
  const tags: Record<string, string> = {};
  const entries = isRecord(raw)
    ? Object.entries(raw)
    : Array.isArray(raw)
      ? raw.filter(Array.isArray).map((pair) => [pair[0], pair[1]] as const)
      : [];
  for (const [key, value] of entries) {
    if (Object.keys(tags).length >= MAX_TAGS) break;
    if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{1,32}$/.test(key)) continue;
    const text = asString(value, MAX_SHORT_LENGTH);
    if (text !== undefined) tags[key] = text;
  }
  return tags;
}

function culpritOf(exceptions: readonly StoredException[]): string {
  const innermost = exceptions.at(-1);
  const frames = innermost?.frames ?? [];
  const frame = frames.findLast((candidate) => candidate.in_app !== false) ?? frames.at(-1);
  if (!frame) return '';
  const file = frame.filename ? frame.filename.replace(/^[a-z]+:\/\/[^/]+/i, '') : '?';
  return `${frame.function ?? '?'}(${file})`;
}

/**
 * Sentry 的事件 payload → 存檔的形狀。只挑已知欄位：`extra`、`contexts`、`request.headers`、
 * `request.cookies`、`user` 除了 id 以外的欄位一律丟掉（設計決策 D7）。
 */
export function normalizeEvent(
  raw: Record<string, unknown>,
  project: string,
  now: Date = new Date(),
): StoredEvent {
  const exceptions = exceptionList(raw.exception)
    .slice(-MAX_EXCEPTIONS)
    .map(normalizeException)
    .filter((exception): exception is StoredException => exception !== undefined);
  const message = messageOf(raw.message) ?? messageOf(raw.logentry);
  const innermost = exceptions.at(-1);
  const title = innermost
    ? `${innermost.type}: ${innermost.value}`.slice(0, MAX_SHORT_LENGTH)
    : (message ?? '<unknown>').slice(0, MAX_SHORT_LENGTH);

  const eventIdRaw = typeof raw.event_id === 'string' ? raw.event_id.replaceAll('-', '') : '';
  const eventId = /^[0-9a-f]{32}$/i.test(eventIdRaw)
    ? eventIdRaw.toLowerCase()
    : randomUUID().replaceAll('-', '');
  const level = typeof raw.level === 'string' && LEVELS.has(raw.level) ? raw.level : 'error';

  const event: StoredEvent = {
    eventId,
    project,
    groupId: computeGroupId({
      project,
      custom: raw.fingerprint,
      type: innermost?.type,
      value: innermost?.value ?? message,
    }),
    title,
    culprit: culpritOf(exceptions),
    level,
    platform: asString(raw.platform, 32) ?? 'javascript',
    timestamp: toIsoTime(raw.timestamp, now),
    receivedAt: now.toISOString(),
    exceptions,
    breadcrumbs: breadcrumbList(raw.breadcrumbs)
      .slice(-MAX_BREADCRUMBS)
      .map(normalizeBreadcrumb)
      .filter((crumb): crumb is StoredBreadcrumb => crumb !== undefined),
    tags: normalizeTags(raw.tags),
  };
  const release = asString(raw.release, 100);
  if (release !== undefined) event.release = release;
  const environment = asString(raw.environment, 64);
  if (environment !== undefined) event.environment = environment;
  const transaction = asString(raw.transaction, MAX_SHORT_LENGTH);
  if (transaction !== undefined) event.transaction = transaction;
  if (message !== undefined) event.message = message;
  if (isRecord(raw.user)) {
    const id = asString(raw.user.id, 64);
    if (id !== undefined) event.user = { id };
  }
  if (isRecord(raw.request)) {
    if (typeof raw.request.url === 'string') event.url = scrubUrl(raw.request.url);
    const headers = isRecord(raw.request.headers) ? raw.request.headers : {};
    const userAgent = asString(headers['User-Agent'] ?? headers['user-agent'], 300);
    if (userAgent !== undefined) event.userAgent = userAgent;
  }
  if (isRecord(raw.sdk)) {
    const sdk: NonNullable<StoredEvent['sdk']> = {};
    const name = asString(raw.sdk.name, 64);
    const version = asString(raw.sdk.version, 32);
    if (name !== undefined) sdk.name = name;
    if (version !== undefined) sdk.version = version;
    event.sdk = sdk;
  }
  return event;
}

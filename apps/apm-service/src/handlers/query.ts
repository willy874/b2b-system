import type { ApmProject } from '@/config';
import type { ApmServices, RequestContext } from '@/context';
import { ApmError } from '@/http/errors';
import { sendJson } from '@/http/respond';
import type { SymbolicatedFrame } from '@/sourcemaps/symbolicate';
import type { StoredEvent } from '@/store/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const UNIT_MS = { m: 60_000, h: 3_600_000, d: DAY_MS, w: 7 * DAY_MS } as const;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** 查詢 API 路徑上的 `<org>/<project>` → 專案；org 不符或專案不存在都是 404。 */
export function resolveProject(
  services: ApmServices,
  org: string | undefined,
  slug: string | undefined,
): ApmProject {
  const project = services.config.projects.find((candidate) => candidate.slug === slug);
  if (org !== services.config.org || !project) throw new ApmError(404, '專案不存在');
  return project;
}

/** Sentry 的 `statsPeriod`（`24h`、`14d`、`90m`、`2w`）；預設 24 小時，最長到保留天數。 */
export function parseStatsPeriod(value: string | null, retentionDays: number, now: Date): Date {
  const maxMs = retentionDays * DAY_MS;
  if (value === null || value === '') return new Date(now.getTime() - Math.min(DAY_MS, maxMs));
  const match = /^(\d{1,5})([mhdw])$/.exec(value);
  if (!match) throw new ApmError(400, 'statsPeriod 的格式是 <數字><m|h|d|w>，例如 24h、14d');
  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof UNIT_MS;
  return new Date(now.getTime() - Math.min(amount * UNIT_MS[unit], maxMs));
}

export interface IssueQuery {
  release?: string;
  transaction?: string;
  level?: string;
  tenant?: string;
  text: string[];
}

/** Sentry 搜尋語法的子集：`release:x transaction:/user/$userId level:error tenant:acme 其他文字`；`is:…` 忽略。 */
export function parseIssueQuery(value: string | null): IssueQuery {
  const query: IssueQuery = { text: [] };
  for (const token of (value ?? '').split(/\s+/).filter(Boolean)) {
    const separator = token.indexOf(':');
    const key = separator > 0 ? token.slice(0, separator) : '';
    const tokenValue = token.slice(separator + 1).replace(/^"(.*)"$/, '$1');
    switch (key) {
      case 'release':
      case 'transaction':
      case 'level':
      case 'tenant':
        query[key] = tokenValue;
        break;
      case 'is':
        break;
      default:
        query.text.push(token.toLowerCase());
    }
  }
  return query;
}

function matches(event: StoredEvent, query: IssueQuery): boolean {
  if (query.release !== undefined && event.release !== query.release) return false;
  if (query.transaction !== undefined && event.transaction !== query.transaction) return false;
  if (query.level !== undefined && event.level !== query.level) return false;
  if (query.tenant !== undefined && event.tags.tenant !== query.tenant) return false;
  const title = event.title.toLowerCase();
  return query.text.every((text) => title.includes(text));
}

interface IssueAggregate {
  latest: StoredEvent;
  count: number;
  users: Set<string>;
  firstSeen: string;
  lastSeen: string;
}

function projectSummary(project: ApmProject) {
  return { id: project.id, slug: project.slug, name: project.slug };
}

function issueOf(project: ApmProject, aggregate: IssueAggregate) {
  const { latest } = aggregate;
  const innermost = latest.exceptions.at(-1);
  return {
    id: latest.groupId,
    shortId: `${project.slug.toUpperCase()}-${latest.groupId.slice(0, 6).toUpperCase()}`,
    title: latest.title,
    culprit: latest.culprit,
    level: latest.level,
    status: 'unresolved',
    platform: latest.platform,
    type: 'error',
    project: projectSummary(project),
    metadata: innermost
      ? { type: innermost.type, value: innermost.value }
      : { title: latest.title },
    // Sentry 的 count 是字串
    count: String(aggregate.count),
    userCount: aggregate.users.size,
    firstSeen: aggregate.firstSeen,
    lastSeen: aggregate.lastSeen,
    lastRelease: latest.release ?? null,
    latestEventID: latest.eventId,
  };
}

/** `GET /api/0/projects/:org/:project/issues/`：依 fingerprint 分組的錯誤（設計決策 D8）。 */
export async function listIssues({ res, url, params, services }: RequestContext): Promise<void> {
  const project = resolveProject(services, params.org, params.project);
  const now = services.now();
  const since = parseStatsPeriod(
    url.searchParams.get('statsPeriod'),
    services.config.retentionDays,
    now,
  );
  const query = parseIssueQuery(url.searchParams.get('query'));
  const limit = Math.min(
    Math.max(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  const groups = new Map<string, IssueAggregate>();
  for await (const event of services.events.scan(project.slug, since)) {
    if (!matches(event, query)) continue;
    const aggregate = groups.get(event.groupId);
    if (!aggregate) {
      groups.set(event.groupId, {
        latest: event,
        count: 1,
        users: new Set(event.user ? [event.user.id] : []),
        firstSeen: event.receivedAt,
        lastSeen: event.receivedAt,
      });
      continue;
    }
    aggregate.count += 1;
    if (event.user) aggregate.users.add(event.user.id);
    if (event.receivedAt < aggregate.firstSeen) aggregate.firstSeen = event.receivedAt;
    if (event.receivedAt > aggregate.lastSeen) {
      aggregate.lastSeen = event.receivedAt;
      aggregate.latest = event;
    }
  }

  const sort = url.searchParams.get('sort') ?? 'date';
  const sorted = [...groups.values()].toSorted((a, b) => {
    if (sort === 'freq') return b.count - a.count;
    if (sort === 'new') return b.firstSeen.localeCompare(a.firstSeen);
    return b.lastSeen.localeCompare(a.lastSeen);
  });
  sendJson(
    res,
    200,
    sorted.slice(0, limit).map((aggregate) => issueOf(project, aggregate)),
  );
}

function toSentryFrame(frame: SymbolicatedFrame) {
  return {
    filename: frame.filename ?? null,
    absPath: frame.abs_path ?? null,
    function: frame.function ?? null,
    lineNo: frame.lineno ?? null,
    colNo: frame.colno ?? null,
    inApp: frame.in_app ?? false,
    context: frame.context_line === undefined ? [] : [[frame.lineno ?? 0, frame.context_line]],
    symbolicated: frame.symbolicated,
    raw:
      frame.raw_filename === undefined
        ? null
        : {
            filename: frame.raw_filename,
            function: frame.raw_function ?? null,
            lineNo: frame.raw_lineno ?? null,
            colNo: frame.raw_colno ?? null,
          },
  };
}

async function eventDetail(services: ApmServices, project: ApmProject, event: StoredEvent) {
  const symbolicated = await services.symbolicator.event(event);
  const entries: Array<{ type: string; data: unknown }> = [];
  if (event.exceptions.length > 0) {
    entries.push({
      type: 'exception',
      data: {
        values: event.exceptions.map((exception, index) => ({
          type: exception.type,
          value: exception.value,
          mechanism: exception.mechanism ?? null,
          stacktrace: {
            frames: (symbolicated[index]?.frames ?? []).map(toSentryFrame),
          },
        })),
      },
    });
  }
  if (event.message !== undefined) {
    entries.push({ type: 'message', data: { formatted: event.message } });
  }
  entries.push({
    type: 'breadcrumbs',
    data: {
      values: event.breadcrumbs.map((crumb) => ({
        ...crumb,
        timestamp:
          crumb.timestamp === undefined ? null : new Date(crumb.timestamp * 1000).toISOString(),
      })),
    },
  });
  if (event.url !== undefined) {
    entries.push({ type: 'request', data: { url: event.url } });
  }
  return {
    id: event.eventId,
    eventID: event.eventId,
    groupID: event.groupId,
    projectID: project.id,
    projectSlug: project.slug,
    title: event.title,
    message: event.message ?? '',
    culprit: event.culprit,
    level: event.level,
    platform: event.platform,
    type: 'error',
    dateCreated: event.timestamp,
    dateReceived: event.receivedAt,
    release: event.release === undefined ? null : { version: event.release },
    environment: event.environment ?? null,
    transaction: event.transaction ?? null,
    user: event.user ?? null,
    tags: Object.entries(event.tags).map(([key, value]) => ({ key, value })),
    contexts: event.userAgent === undefined ? {} : { browser: { userAgent: event.userAgent } },
    sdk: event.sdk ?? null,
    entries,
  };
}

/** `GET /api/0/projects/:org/:project/events/:eventId/`：單一事件，堆疊以 sourcemap 還原（設計決策 D5）。 */
export async function getEvent({ res, params, services }: RequestContext): Promise<void> {
  const project = resolveProject(services, params.org, params.project);
  const eventId = (params.eventId ?? '').replaceAll('-', '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(eventId)) throw new ApmError(400, 'event id 必須是 32 碼 hex');
  const since = new Date(services.now().getTime() - services.config.retentionDays * DAY_MS);
  const event = await services.events.findById(project.slug, eventId, since);
  if (!event) throw new ApmError(404, '事件不存在或已超過保留期限');
  sendJson(res, 200, await eventDetail(services, project, event));
}

/** `GET /api/0/organizations/:org/issues/:issueId/events/latest/`：某個 issue 最新的一筆事件。 */
export async function getLatestIssueEvent({
  res,
  params,
  services,
}: RequestContext): Promise<void> {
  if (params.org !== services.config.org) throw new ApmError(404, '組織不存在');
  const issueId = params.issueId ?? '';
  if (!/^[0-9a-f]{16}$/.test(issueId)) throw new ApmError(400, 'issue id 必須是 16 碼 hex');
  const since = new Date(services.now().getTime() - services.config.retentionDays * DAY_MS);
  const needle = `"groupId":"${issueId}"`;
  for (const project of services.config.projects) {
    let latest: StoredEvent | undefined;
    // oxlint-disable-next-line no-await-in-loop -- 依序找：專案只有幾個，找到就停
    for await (const event of services.events.scan(project.slug, since, (line) =>
      line.includes(needle),
    )) {
      if (event.groupId === issueId && (!latest || event.receivedAt > latest.receivedAt))
        latest = event;
    }
    if (latest) {
      // oxlint-disable-next-line no-await-in-loop -- 找到就回應並結束
      sendJson(res, 200, await eventDetail(services, project, latest));
      return;
    }
  }
  throw new ApmError(404, 'issue 不存在或已超過保留期限');
}

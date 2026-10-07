import type { RequestContext } from '@/context';
import { ingestEnvelope } from '@/handlers/ingest';
import { getEvent, getLatestIssueEvent, listIssues } from '@/handlers/query';
import { listReleaseFiles, uploadReleaseFile } from '@/handlers/release-files';
import { sendText } from '@/http/respond';

export interface Route {
  method: string;
  /** 路徑（不含 query）；具名群組成為 `params`。結尾的 `/` 可有可無（Sentry 的端點都以 `/` 結尾）。 */
  pattern: RegExp;
  /** 日誌用的操作名稱。 */
  operation: string;
  /** `token`：查詢與上傳 API，要 `Authorization: Bearer`；`ingest` 由 handler 自己以 DSN 驗證；`none` 不驗證。 */
  auth: 'token' | 'ingest' | 'none';
  handler: (context: RequestContext) => Promise<void>;
}

const SLUG = '[a-z][a-z0-9-]{0,49}';

export const ROUTES: readonly Route[] = [
  {
    method: 'GET',
    pattern: /^\/_health$/,
    operation: 'Health',
    auth: 'none',
    handler: async ({ res }) => sendText(res, 200, 'ok'),
  },
  {
    method: 'GET',
    pattern: /^\/metrics$/,
    operation: 'Metrics',
    auth: 'none',
    handler: async ({ res, services }) =>
      sendText(res, 200, services.metrics.render(), 'text/plain; version=0.0.4; charset=utf-8'),
  },
  {
    method: 'POST',
    pattern: /^\/api\/(?<projectId>\d{1,10})\/envelope\/?$/,
    operation: 'Envelope',
    auth: 'ingest',
    handler: ingestEnvelope,
  },
  {
    method: 'POST',
    pattern: new RegExp(
      `^/api/0/projects/(?<org>${SLUG})/(?<project>${SLUG})/releases/(?<version>[^/]+)/files/?$`,
    ),
    operation: 'UploadReleaseFile',
    auth: 'token',
    handler: uploadReleaseFile,
  },
  {
    method: 'GET',
    pattern: new RegExp(
      `^/api/0/projects/(?<org>${SLUG})/(?<project>${SLUG})/releases/(?<version>[^/]+)/files/?$`,
    ),
    operation: 'ListReleaseFiles',
    auth: 'token',
    handler: listReleaseFiles,
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/api/0/projects/(?<org>${SLUG})/(?<project>${SLUG})/issues/?$`),
    operation: 'ListIssues',
    auth: 'token',
    handler: listIssues,
  },
  {
    method: 'GET',
    pattern: new RegExp(
      `^/api/0/projects/(?<org>${SLUG})/(?<project>${SLUG})/events/(?<eventId>[0-9a-fA-F-]{32,36})/?$`,
    ),
    operation: 'GetEvent',
    auth: 'token',
    handler: getEvent,
  },
  {
    method: 'GET',
    pattern: new RegExp(
      `^/api/0/organizations/(?<org>${SLUG})/issues/(?<issueId>[0-9a-f]{16})/events/latest/?$`,
    ),
    operation: 'GetLatestIssueEvent',
    auth: 'token',
    handler: getLatestIssueEvent,
  },
];

export interface ResolvedRoute {
  route: Route;
  params: Record<string, string>;
}

/** 路徑對得上但方法不對時回 `methodNotAllowed: true`（405）。 */
export function resolveRoute(
  method: string,
  pathname: string,
): ResolvedRoute | { methodNotAllowed: boolean } {
  let pathMatched = false;
  for (const route of ROUTES) {
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    pathMatched = true;
    if (route.method !== method) continue;
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(match.groups ?? {})) {
      params[key] = decodeURIComponent(value);
    }
    return { route, params };
  }
  return { methodNotAllowed: pathMatched };
}

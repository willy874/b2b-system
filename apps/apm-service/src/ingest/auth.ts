import { timingSafeEqual } from 'node:crypto';

import type { ApmProject } from '@/config';
import { ApmError } from '@/http/errors';

/** `X-Sentry-Auth: Sentry sentry_key=abc, sentry_version=7, sentry_client=…` */
function keyFromAuthHeader(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = /(?:^|[\s,])sentry_key=([^,\s]+)/.exec(value);
  return match?.[1];
}

/** envelope header 的 `dsn`（走 SDK 的 `tunnel` 時只有這裡有 key）：`https://<key>@host/<id>` */
function keyFromDsn(dsn: unknown): string | undefined {
  if (typeof dsn !== 'string') return undefined;
  try {
    const username = new URL(dsn).username;
    return username === '' ? undefined : decodeURIComponent(username);
  } catch {
    return undefined;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface IngestCredentials {
  query: URLSearchParams;
  authHeader: string | undefined;
  envelopeDsn: unknown;
}

/**
 * 收件端點的驗證：DSN 的 public key 必須屬於路徑上的專案。
 * public key 會出現在前端產物裡，不是秘密；它只用來確認事件送到了正確的專案，
 * 防濫用靠限流與內容上限（docs/architecture/07-apm-service.md）。
 */
export function authenticateIngest(
  projects: readonly ApmProject[],
  projectId: string,
  credentials: IngestCredentials,
): ApmProject {
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new ApmError(404, `專案 ${projectId} 不存在`);
  const key =
    credentials.query.get('sentry_key') ??
    keyFromAuthHeader(credentials.authHeader) ??
    keyFromDsn(credentials.envelopeDsn);
  if (key === undefined) throw new ApmError(401, '缺少 sentry_key');
  if (!safeEqual(key, project.publicKey)) throw new ApmError(401, 'sentry_key 與專案不符');
  return project;
}

/** 查詢與上傳 API：`Authorization: Bearer <APM_AUTH_TOKEN>`。 */
export function authenticateApi(authorization: string | undefined, token: string): void {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? '');
  if (!match?.[1]) throw new ApmError(401, '缺少 Authorization: Bearer <token>');
  if (!safeEqual(match[1], token)) throw new ApmError(401, 'token 不正確');
}

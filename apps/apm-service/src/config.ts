import { resolve } from 'node:path';

import { z } from 'zod';

/** 一個收件的專案：DSN 的 `<publicKey>@…/<id>`，查詢 API 以 `slug` 指定。 */
export interface ApmProject {
  /** Sentry 的專案 id 是數字；DSN 路徑的最後一段。 */
  id: string;
  slug: string;
  publicKey: string;
}

const PROJECT_PATTERN = /^(\d{1,10}):([a-z][a-z0-9-]{0,49}):([A-Za-z0-9]{16,64})$/;

/** `1:backstage:<publicKey>,2:platform:<publicKey>` */
const projectsSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    const projects: ApmProject[] = [];
    for (const entry of value.split(',').map((item) => item.trim())) {
      const match = PROJECT_PATTERN.exec(entry);
      if (!match) {
        ctx.addIssue({
          code: 'custom',
          message: `專案格式必須是 <數字 id>:<slug>:<16～64 碼英數 public key>，收到「${entry}」`,
        });
        return z.NEVER;
      }
      const [, id = '', slug = '', publicKey = ''] = match;
      projects.push({ id, slug, publicKey });
    }
    const ids = new Set(projects.map((project) => project.id));
    const slugs = new Set(projects.map((project) => project.slug));
    if (ids.size !== projects.length || slugs.size !== projects.length) {
      ctx.addIssue({ code: 'custom', message: '專案的 id 與 slug 都不可重複' });
      return z.NEVER;
    }
    return projects;
  });

/**
 * 環境變數缺少或格式錯誤時啟動失敗，與 apps/api 的 `env.schema.ts` 同一個原則。
 */
const EnvSchema = z.object({
  APM_HOST: z.string().trim().min(1).default('127.0.0.1'),
  APM_PORT: z.coerce.number().int().min(0).max(65_535).default(9100),
  /** 相對路徑以 `apps/apm-service/` 為基準。 */
  APM_DATA_DIR: z.string().trim().min(1).default('.data'),
  /** 查詢 API 路徑裡的 organization slug（`/api/0/projects/<org>/<project>/…`）。 */
  APM_ORG: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{0,49}$/)
    .default('b2b-system'),
  APM_PROJECTS: projectsSchema,
  /** 查詢與上傳 sourcemap 的 `Authorization: Bearer <token>`。 */
  APM_AUTH_TOKEN: z.string().trim().min(16).max(256),
  APM_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** 一個 envelope（解壓縮後）的上限；SDK 的事件通常在 100 KB 以內。 */
  APM_MAX_ENVELOPE_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(20 * 1024 * 1024)
    .default(1024 * 1024),
  /** 一個 sourcemap 檔案的上限。 */
  APM_MAX_SOURCEMAP_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(200 * 1024 * 1024)
    .default(50 * 1024 * 1024),
  /** 每個來源 IP、每個專案、每分鐘可以收幾個 envelope。 */
  APM_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(120),
  /**
   * 在反向代理後面時，以 `X-Real-IP` 當來源 IP（nginx 已依 TRUSTED_PROXY_CIDRS 算好真實位址）。
   * 直接對外時一定要關掉，否則任何人都能偽造來源繞過限流。
   */
  APM_TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** `/metrics` 的 route 標籤每個專案最多幾種，超過的歸到 `other`（docs/architecture/frontend/19-observability.md §9.2 D10）。 */
  APM_ROUTE_LABEL_LIMIT: z.coerce.number().int().min(1).max(10_000).default(200),
  /** `/metrics` 的 `apm_events_total` 每個專案保留最近幾個 release（docs/architecture/08-monitoring.md §5.1）。 */
  APM_RELEASE_LABEL_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
});

export interface ApmConfig {
  host: string;
  port: number;
  dataDir: string;
  org: string;
  projects: readonly ApmProject[];
  authToken: string;
  retentionDays: number;
  maxEnvelopeBytes: number;
  maxSourcemapBytes: number;
  rateLimitPerMinute: number;
  trustProxy: boolean;
  routeLabelLimit: number;
  releaseLabelLimit: number;
}

/**
 * @param baseDir `APM_DATA_DIR` 為相對路徑時的基準目錄。
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  baseDir: string = process.cwd(),
): ApmConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `apm-service 的環境變數不正確，請對照根目錄 .env.example 補上 APM_*：\n${z.prettifyError(parsed.error)}`,
    );
  }
  const values = parsed.data;
  return {
    host: values.APM_HOST,
    port: values.APM_PORT,
    dataDir: resolve(baseDir, values.APM_DATA_DIR),
    org: values.APM_ORG,
    projects: values.APM_PROJECTS,
    authToken: values.APM_AUTH_TOKEN,
    retentionDays: values.APM_RETENTION_DAYS,
    maxEnvelopeBytes: values.APM_MAX_ENVELOPE_BYTES,
    maxSourcemapBytes: values.APM_MAX_SOURCEMAP_BYTES,
    rateLimitPerMinute: values.APM_RATE_LIMIT_PER_MINUTE,
    trustProxy: values.APM_TRUST_PROXY,
    routeLabelLimit: values.APM_ROUTE_LABEL_LIMIT,
    releaseLabelLimit: values.APM_RELEASE_LABEL_LIMIT,
  };
}

import { header, type RequestContext } from '@/context';
import { readBody } from '@/http/body';
import { ApmError } from '@/http/errors';
import { sendJson } from '@/http/respond';
import { assertRelease } from '@/sourcemaps/sourcemap-store';

import { resolveProject } from './query';

/** multipart 的欄位名稱與邊界等額外位元組。 */
const MULTIPART_OVERHEAD = 64 * 1024;

/**
 * `POST /api/0/projects/:org/:project/releases/:version/files/`：Sentry 舊版的 release 檔案上傳
 * （multipart：`file`、`name`），存進 `.data/sourcemaps/`（docs/architecture/frontend/19-observability.md §9.2 D4）。
 */
export async function uploadReleaseFile({
  req,
  res,
  params,
  services,
}: RequestContext): Promise<void> {
  const project = resolveProject(services, params.org, params.project);
  const release = params.version ?? '';
  assertRelease(release);
  const contentType = header(req, 'content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new ApmError(415, '請以 multipart/form-data 上傳（欄位 file、name）');
  }
  const body = await readBody(req, services.config.maxSourcemapBytes + MULTIPART_OVERHEAD);

  let form: FormData;
  try {
    form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw new ApmError(400, 'multipart 內容無法解析');
  }
  const file = form.get('file');
  if (!(file instanceof Blob)) throw new ApmError(400, '缺少欄位 file');
  if (file.size > services.config.maxSourcemapBytes) {
    throw new ApmError(413, `檔案超過 ${services.config.maxSourcemapBytes} 位元組`);
  }
  const nameField = form.get('name');
  const name =
    typeof nameField === 'string' && nameField !== ''
      ? nameField
      : file instanceof File && file.name !== ''
        ? `~/${file.name}`
        : undefined;
  if (name === undefined)
    throw new ApmError(400, '缺少欄位 name（例：~/assets/index-abc123.js.map）');

  const saved = await services.sourcemaps.save(
    project.slug,
    release,
    name,
    Buffer.from(await file.arrayBuffer()),
  );
  sendJson(res, 201, { ...saved, dist: null, headers: {} });
}

/** `GET /api/0/projects/:org/:project/releases/:version/files/` */
export async function listReleaseFiles({ res, params, services }: RequestContext): Promise<void> {
  const project = resolveProject(services, params.org, params.project);
  const release = params.version ?? '';
  assertRelease(release);
  const files = await services.sourcemaps.list(project.slug, release);
  sendJson(
    res,
    200,
    files.map((file) => Object.assign(file, { dist: null, headers: {} })),
  );
}

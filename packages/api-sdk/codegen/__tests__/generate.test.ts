import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { generate } from '../generate';
import { petStoreSpec } from './fixtures/pet-store';

const runtimeSource = readFileSync(resolve(import.meta.dirname, '../runtime.ts'), 'utf8');
/** 放在 package 內，產出的檔案才解析得到 `zod`；已列入 .gitignore */
const outputDir = resolve(import.meta.dirname, '.output/pet-store');

// 產出的程式碼在測試裡動態 import，型別由 tsc 那個案例另外驗證
type Sdk = Record<string, any>;
let sdk: Sdk;

function file(path: string): string {
  const found = generate(petStoreSpec, { runtimeSource }).files.find(
    (entry) => entry.path === path,
  );
  if (!found) throw new Error(`沒有產生 ${path}`);
  return found.content;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeAll(async () => {
  rmSync(outputDir, { recursive: true, force: true });
  for (const entry of generate(petStoreSpec, { runtimeSource }).files) {
    const target = join(outputDir, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.content);
  }
  sdk = (await import(join(outputDir, 'index.ts'))) as Sdk;
});

afterEach(() => {
  sdk.resetSdkConfig();
  vi.unstubAllGlobals();
});

describe('generate（檔案結構）', () => {
  it('依 tag 分檔，沒有 tag 的歸到 default', () => {
    const paths = generate(petStoreSpec, { runtimeSource }).files.map((entry) => entry.path);
    expect(paths).toEqual([
      'runtime.ts',
      'models.ts',
      'schemas.ts',
      'endpoints/default.ts',
      'endpoints/pet-media.ts',
      'endpoints/pets.ts',
      'index.ts',
    ]);
  });

  it('字串 enum 同時輸出 const 物件與聯集型別', () => {
    expect(file('models.ts')).toContain('export const PetStatus = {\navailable: "available",');
    expect(file('models.ts')).toContain(
      'export type PetStatus = (typeof PetStatus)[keyof typeof PetStatus];',
    );
  });

  it('循環引用的 schema 以 z.lazy 延後並標註型別；其餘用 satisfies 對齊 models', () => {
    const schemas = file('schemas.ts');
    expect(schemas).toContain('export const CategorySchema: z.ZodType<Category> = z.object({');
    expect(schemas).toContain('children: z.array(z.lazy(() => CategorySchema))');
    expect(schemas).toMatch(
      /export const PetSchema = z\.intersection\(NewPetSchema, [\s\S]*?\) satisfies z\.ZodType<Pet>;/,
    );
    // 被引用的 schema 必須先宣告
    expect(schemas.indexOf('export const CategorySchema')).toBeLessThan(
      schemas.indexOf('export const PetSchema'),
    );
  });

  it('deprecated operation 帶 @deprecated', () => {
    expect(file('endpoints/pets.ts')).toContain('/** @deprecated */\nexport function deletePet(');
  });

  it('匯出名稱衝突時直接失敗', () => {
    const spec = structuredClone(petStoreSpec) as unknown as {
      components: { schemas: Record<string, unknown> };
    };
    spec.components.schemas.GetPetResult = { type: 'string' };
    expect(() => generate(spec, { runtimeSource })).toThrow(/GetPetResult/);
  });

  it('路徑用到未宣告的 path 參數時失敗', () => {
    const spec = structuredClone(petStoreSpec) as unknown as { paths: Record<string, unknown> };
    spec.paths['/owners/{ownerId}'] = { get: { operationId: 'getOwner', responses: {} } };
    expect(() => generate(spec, { runtimeSource })).toThrow(/ownerId/);
  });

  it('拒絕 Swagger 2.0', () => {
    expect(() => generate({ swagger: '2.0' }, { runtimeSource })).toThrow(/openapi/);
  });
});

describe('generate（產出的程式碼可以編譯）', () => {
  it('在 strict ＋ noUncheckedIndexedAccess ＋ noUnusedLocals 下通過 tsc', () => {
    const tsconfig = join(outputDir, 'tsconfig.json');
    writeFileSync(
      tsconfig,
      JSON.stringify({
        extends: resolve(import.meta.dirname, '../../../../tsconfig.base.json'),
        compilerOptions: {
          noEmit: true,
          composite: false,
          incremental: false,
          lib: ['ES2023', 'DOM'],
          types: [],
        },
        include: ['./**/*.ts'],
      }),
    );
    const tsc = resolve(import.meta.dirname, '../../node_modules/.bin/tsc');
    expect(() => execFileSync(tsc, ['-p', tsconfig], { stdio: 'pipe' })).not.toThrow();
  }, 30_000);
});

describe('產出的 endpoint 函式（只用 fetch）', () => {
  it('組出 URL、query、header，並回傳 { status, data, headers }', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, [{ id: 1, name: 'Rex' }]));
    sdk.configureSdk({ baseUrl: 'https://api.test', fetch: fetchMock });

    const result = await sdk.listPets({
      query: { limit: 5, status: ['available', 'sold'] },
      headers: { 'X-Request-Id': 'abc' },
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/pets?limit=5&status=available&status=sold');
    expect(new Headers(init.headers).get('x-request-id')).toBe('abc');
    expect(result.status).toBe(200);
    expect(result.data).toEqual([{ id: 1, name: 'Rex' }]);
  });

  it('沒有設定 fetch 時使用呼叫當下的全域 fetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: 3, name: 'Tom' }));
    vi.stubGlobal('fetch', fetchMock);
    await sdk.getPet({ path: { petId: 3 } });
    expect(fetchMock).toHaveBeenCalledWith('/pets/3', expect.objectContaining({ method: 'GET' }));
  });

  it('JSON body 帶 content-type；options 的標頭蓋過全域標頭', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { id: 1, name: 'Rex' }));
    sdk.configureSdk({ fetch: fetchMock, headers: { 'x-app': 'a', 'x-env': 'dev' } });

    await sdk.createPet({ body: { name: 'Rex' } }, { headers: { 'x-env': 'prod' } });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"Rex"}');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-app')).toBe('a');
    expect(headers.get('x-env')).toBe('prod');
  });

  it('multipart 不自行設定 content-type（交給 fetch 帶 boundary）', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 202 }));
    const result = await sdk.uploadPhoto(
      { path: { petId: 1 }, body: { file: new Blob(['x']), caption: 'hi' } },
      { fetch: fetchMock },
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).has('content-type')).toBe(false);
    expect(result).toMatchObject({ status: 202, data: 'ok' });
  });

  it('204 回應的 data 是 undefined', async () => {
    const result = await sdk.deletePet(
      { path: { petId: 1 } },
      { fetch: async () => new Response(null, { status: 204 }) },
    );
    expect(result.data).toBeUndefined();
  });

  it('非 2xx 丟 ApiError，data 已解析', async () => {
    const call = sdk.createPet(
      { body: { name: 'Rex' } },
      { fetch: async () => jsonResponse(422, { code: 'INVALID' }) },
    );
    await expect(call).rejects.toBeInstanceOf(sdk.ApiError);
    await expect(call).rejects.toMatchObject({
      status: 422,
      data: { code: 'INVALID' },
      operationId: 'createPet',
    });
  });

  it('開啟請求驗證：不合法的 body 不會送出，合法的會套用預設值', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { id: 1, name: 'Rex' }));
    sdk.configureSdk({ fetch: fetchMock, validate: { request: true } });

    await expect(sdk.createPet({ body: { name: '' } })).rejects.toMatchObject({
      name: 'ApiValidationError',
      target: 'body',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await sdk.createPet({ body: { name: 'Rex' } });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Rex', vaccinated: false });
  });

  it('開啟回應驗證：回應不符合 schema 時丟 ApiValidationError', async () => {
    const call = sdk.getPet(
      { path: { petId: 1 } },
      {
        validate: { response: true },
        fetch: async () => jsonResponse(200, { id: 'x', name: 'Rex' }),
      },
    );
    await expect(call).rejects.toMatchObject({ name: 'ApiValidationError', target: 'response' });
  });

  it('循環 schema 可以驗證巢狀資料', async () => {
    const tree = [{ name: 'a', children: [{ name: 'b', children: [] }] }];
    const result = await sdk.listCategories({
      validate: true,
      fetch: async () => jsonResponse(200, tree),
    });
    expect(result.data).toEqual(tree);
  });

  it('URL builder 可以單獨使用（給自帶傳輸層的應用）', () => {
    expect(sdk.getGetPetUrl({ petId: 7 })).toBe('/pets/7');
    expect(sdk.getListPetsUrl({ limit: 1 })).toBe('/pets?limit=1');
  });
});

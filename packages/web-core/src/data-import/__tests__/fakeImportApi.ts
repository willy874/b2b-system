import { vi } from 'vitest';

import { sessionStore } from '../../auth';
import type { ImportApi, ImportColumnView } from '../../data-transfer';
import { fakeTransferApi } from '../../data-transfer/__tests__/fakeTransferApi';

export { transfer } from '../../data-transfer/__tests__/fakeTransferApi';

/** 匯入欄位；預設是必填、唯一的 Email 文字欄。 */
export function importColumn(overrides: Partial<ImportColumnView> = {}): ImportColumnView {
  return {
    key: 'email',
    label: 'Email',
    kind: 'string',
    required: true,
    multiple: false,
    matchKey: null,
    unique: true,
    nullable: false,
    suggest: false,
    hint: null,
    options: null,
    transitions: null,
    ...overrides,
  };
}

export const COLUMNS: ImportColumnView[] = [importColumn()];

/** 匯入用的 API：分析回兩列（第 2 列 Email 格式錯誤），其餘回空的結果。 */
export function fakeImportApi(overrides: Partial<ImportApi> = {}): ImportApi {
  return {
    ...fakeTransferApi(),
    columnsKey: (type, mode) => ['columns', type, mode],
    fetchColumns: async () => ({ items: COLUMNS, readOnly: [] }),
    downloadTemplate: async () => ({ blob: new Blob([]), fileName: 't.csv' }),
    analyze: vi.fn(async () => ({
      status: 'ok' as const,
      fileName: 'users.csv',
      columns: COLUMNS,
      ignored: [],
      rows: [
        { rowNo: 1, sourceRow: 2, cells: { email: 'a@example.com' } },
        { rowNo: 2, sourceRow: 3, cells: { email: 'bad' } },
      ],
      results: [
        { rowNo: 1, issues: [] },
        {
          rowNo: 2,
          issues: [
            {
              column: 'email',
              code: 'invalidFormat',
              params: { format: 'email' },
              severity: 'error' as const,
            },
          ],
        },
      ],
    })),
    validate: vi.fn(async () => ({ rows: [] })),
    searchOptions: async () => [],
    createImport: vi.fn(
      async () => ({ id: 'transfer-1' }) as Awaited<ReturnType<ImportApi['createImport']>>,
    ),
    ...overrides,
  };
}

/** 以假的 JWT 登入（身分是 `<tid>:<sub>`），草稿以身分區分。回傳身分。 */
export function signIn(sub = 'alice', tid = 'acme'): string {
  const payload = btoa(JSON.stringify({ sub, tid }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  sessionStore.setTokens({ accessToken: `header.${payload}.signature`, expiresIn: 300 });
  return `${tid}:${sub}`;
}

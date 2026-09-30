import { describe, expect, it } from 'vitest';

import { FileFolderNameSchema } from '../dto/file-folder.dto';
import { personalFolderName } from '../file-system-folder.service';

const ALICE = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Alice',
  email: 'alice@example.com',
};

describe('personalFolderName（個人資料夾的候選名稱，EDGE-16）', () => {
  it.each([
    [0, 'Alice'],
    [1, 'Alice (alice@example.com)'],
    [2, 'Alice (alice@example.com) 2'],
    [7, 'Alice (alice@example.com) 7'],
    [21, `Alice (${ALICE.id})`],
  ])('第 %i 個候選 → %s', (attempt, expected) => {
    expect(personalFolderName(ALICE, attempt)).toBe(expected);
  });

  it.each([
    ['a/b\\c', 'a b c'],
    ['..', 'alice@example.com'],
    ['  \u0007 ', 'alice@example.com'],
    ['x'.repeat(300), 'x'.repeat(255)],
  ])('顯示名稱 %j 清理成合法的資料夾名稱 %j', (displayName, expected) => {
    const name = personalFolderName({ ...ALICE, displayName }, 0);
    expect(name).toBe(expected);
    expect(FileFolderNameSchema.safeParse(name).success).toBe(true);
  });

  it('加上後綴後仍不超過 255 字，且後綴完整保留', () => {
    const name = personalFolderName({ ...ALICE, displayName: 'y'.repeat(300) }, 3);
    expect(name).toHaveLength(255);
    expect(name.endsWith(' (alice@example.com) 3')).toBe(true);
    expect(FileFolderNameSchema.safeParse(name).success).toBe(true);
  });
});

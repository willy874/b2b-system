import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AppError, isVersionConflict } from '@/core/errors';
import { initTestI18n } from '@/test/i18n';
import { AllProviders } from '@/test/renderWithPermissions';

import { VersionConflictAlert } from './VersionConflictAlert';

beforeAll(() => initTestI18n());

describe('isVersionConflict（docs/architecture/backend/03-api-conventions.md §11）', () => {
  it.each([
    [new AppError('USER_VERSION_CONFLICT', 409, { current: 2 }), true],
    [new AppError('FILE_VERSION_CONFLICT', 409), true],
    [new AppError('USER_ROLES_CONFLICT', 409), false],
    [new AppError('USER_NOT_FOUND', 404), false],
    [new Error('USER_VERSION_CONFLICT'), false],
  ])('%s → %s', (error, expected) => {
    expect(isVersionConflict(error)).toBe(expected);
  });
});

describe('VersionConflictAlert', () => {
  it('以錯誤碼的訊息說明被別人修改，按「重新載入」呼叫 onReload', async () => {
    const onReload = vi.fn();
    render(
      <VersionConflictAlert
        error={new AppError('ROLE_VERSION_CONFLICT', 409, { current: 3 })}
        onReload={onReload}
      />,
      { wrapper: AllProviders },
    );

    expect(screen.getByRole('alert')).toHaveTextContent('已經被其他人修改');
    await userEvent.click(screen.getByTestId('version-conflict-reload'));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

import { createDraftStore } from '@b2b-system/web-shared/storage';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sessionStore } from '../../auth';
import { AllProviders } from '../../testing/renderWithPermissions';
import { FormDraftNotice } from '../FormDraftNotice';
import {
  formDraftStore,
  handleSessionEndForDrafts,
  handleSessionStartForDrafts,
  sanitizeDraft,
  setFormDraftStore,
} from '../formDrafts';
import { useFormDraft } from '../useFormDraft';

/** 只解碼的 JWT：`sessionStore.getIdentity()` 以 `tid:sub` 區分是誰。 */
function tokenFor(sub: string): string {
  const payload = btoa(JSON.stringify({ sub, tid: 't1' }));
  return `header.${payload}.signature`;
}

interface Values {
  name: string;
  password: string;
  version: number;
}

function Editor() {
  const [values, setValues] = useState<Values>({ name: '', password: '', version: 3 });
  const draft = useFormDraft({
    key: 'user.detail:u1',
    values,
    dirty: values.name !== '',
    onRestore: (saved) => setValues((current) => ({ ...current, ...saved })),
  });
  return (
    <>
      <FormDraftNotice draft={draft} />
      <input
        aria-label="name"
        value={values.name}
        onChange={(event) => setValues({ ...values, name: event.target.value })}
      />
      <input
        aria-label="password"
        value={values.password}
        onChange={(event) => setValues({ ...values, password: event.target.value })}
      />
      <output data-testid="values">{JSON.stringify(values)}</output>
    </>
  );
}

describe('表單草稿（docs/architecture/frontend/09-state-and-storage.md §4.4）', () => {
  beforeEach(() => {
    setFormDraftStore(createDraftStore({ indexedDB: undefined }));
    sessionStore.setTokens({ accessToken: tokenFor('alice'), expiresIn: 300 });
  });

  afterEach(() => {
    setFormDraftStore(undefined);
    sessionStore.clear();
  });

  it('非自願結束時存下 dirty 的內容（不含密碼）；回到同一頁提示，還原後套用', async () => {
    const first = render(<Editor />, { wrapper: AllProviders });
    await userEvent.type(screen.getByLabelText('name'), 'Alice');
    await userEvent.type(screen.getByLabelText('password'), 'secret-value');
    await act(() => handleSessionEndForDrafts('AUTH_REFRESH_EXPIRED', 't1:alice'));
    first.unmount();

    render(<Editor />, { wrapper: AllProviders });
    expect(await screen.findByTestId('form-draft-notice')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('form-draft-restore'));

    const restored = JSON.parse(
      screen.getByTestId('values').textContent ?? '{}',
    ) as Partial<Values>;
    expect(restored).toEqual({ name: 'Alice', password: '', version: 3 });
    expect(screen.queryByTestId('form-draft-notice')).not.toBeInTheDocument();
    expect(await formDraftStore().load('t1:alice', 'user.detail:u1')).toBeUndefined();
  });

  it('沒有改動的表單不存；捨棄會刪掉草稿', async () => {
    const first = render(<Editor />, { wrapper: AllProviders });
    await act(() => handleSessionEndForDrafts('AUTH_REFRESH_EXPIRED', 't1:alice'));
    first.unmount();
    expect(await formDraftStore().load('t1:alice', 'user.detail:u1')).toBeUndefined();

    await formDraftStore().save('t1:alice', 'user.detail:u1', { name: 'Old', version: 1 });
    render(<Editor />, { wrapper: AllProviders });
    await userEvent.click(await screen.findByTestId('form-draft-discard'));
    await waitFor(async () =>
      expect(await formDraftStore().load('t1:alice', 'user.detail:u1')).toBeUndefined(),
    );
  });

  it('不保留的原因（例：帳號停用）不存，並清掉那個人既有的草稿', async () => {
    await formDraftStore().save('t1:alice', 'other', { a: 1 });
    render(<Editor />, { wrapper: AllProviders });
    await userEvent.type(screen.getByLabelText('name'), 'Alice');
    await act(() => handleSessionEndForDrafts('AUTH_ACCOUNT_DISABLED', 't1:alice'));
    expect(await formDraftStore().load('t1:alice', 'user.detail:u1')).toBeUndefined();
    expect(await formDraftStore().load('t1:alice', 'other')).toBeUndefined();
  });

  it('登入成為另一個人：上一個人的草稿清掉', async () => {
    await formDraftStore().save('t1:alice', 'k', 1);
    await handleSessionStartForDrafts('t1:bob');
    expect(await formDraftStore().load('t1:alice', 'k')).toBeUndefined();
  });

  it('敏感欄位與 exclude 不存（巢狀也一樣）', () => {
    expect(
      sanitizeDraft(
        {
          name: 'a',
          newPassword: 'x',
          nested: { apiToken: 'y', note: 'z' },
          list: [{ secret: 1 }],
        },
        new Set(['note']),
      ),
    ).toEqual({ name: 'a', nested: {}, list: [{}] });
  });
});

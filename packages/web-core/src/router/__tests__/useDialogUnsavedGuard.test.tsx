import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { initTestI18n, renderInRouter } from '../../testing';
import { useDialogUnsavedGuard } from '../useDialogUnsavedGuard';

/** 以 state 開關的表單對話框：輸入了內容就是 dirty。 */
function NameDialog({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState('');
  const close = () => {
    setOpen(false);
    onClose();
  };
  const guard = useDialogUnsavedGuard(open && name !== '', close);
  return (
    <Dialog
      open={open}
      onOpenChange={guard.onOpenChange}
      title="建立"
      data-testid="name-dialog"
      footer={
        <>
          <Button onClick={guard.requestClose} data-testid="name-cancel">
            取消
          </Button>
          <Button onClick={close} data-testid="name-save">
            儲存
          </Button>
        </>
      }
    >
      <input
        aria-label="名稱"
        value={name}
        onChange={(event) => setName(event.target.value)}
        data-testid="name-input"
      />
    </Dialog>
  );
}

async function renderDialog() {
  const onClose = vi.fn();
  const result = renderInRouter(<NameDialog onClose={onClose} />);
  const input = await screen.findByTestId('name-input');
  return { ...result, onClose, input };
}

beforeAll(() => initTestI18n());

describe('useDialogUnsavedGuard（state 對話框的未儲存提醒）', () => {
  it('沒有輸入時按 Esc：直接關閉，不確認', async () => {
    const { onClose, input } = await renderDialog();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
  });

  it('輸入後按 Esc：先確認；選「繼續編輯」後對話框與輸入都還在', async () => {
    const { onClose, input } = await renderDialog();
    fireEvent.change(input, { target: { value: 'Acme' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    const confirm = await screen.findByTestId('unsaved-changes-confirm');
    expect(confirm).toHaveTextContent('要放棄尚未儲存的變更嗎？');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('name-input')).toHaveValue('Acme');
  });

  it('輸入後按取消：選「放棄變更」才關閉', async () => {
    const { onClose, input } = await renderDialog();
    fireEvent.change(input, { target: { value: 'Acme' } });
    fireEvent.click(screen.getByTestId('name-cancel'));

    const confirm = await screen.findByTestId('unsaved-changes-confirm');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('name-dialog')).toBeNull());
  });

  it('儲存（直接呼叫 onClose）：不確認', async () => {
    const { onClose, input } = await renderDialog();
    fireEvent.change(input, { target: { value: 'Acme' } });
    fireEvent.click(screen.getByTestId('name-save'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
  });

  it('對話框開著、有輸入時換頁：路由的 guard 也攔下', async () => {
    const { router, input } = await renderDialog();
    fireEvent.change(input, { target: { value: 'Acme' } });
    router.history.push('/elsewhere');

    expect(await screen.findByTestId('unsaved-changes-confirm')).toBeInTheDocument();
  });
});

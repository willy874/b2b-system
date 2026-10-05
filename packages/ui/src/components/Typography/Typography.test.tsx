import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Paragraph, Text, Title, Typography } from './index';
import { getNodeText } from './useCopyable';

describe('Typography', () => {
  it('pageTitle 預設渲染成 h1', () => {
    render(<Typography variant="pageTitle">角色</Typography>);
    expect(screen.getByRole('heading', { level: 1, name: '角色' })).toBeInTheDocument();
  });

  it('可用 as 覆寫語意標籤（視覺與語意分離）', () => {
    render(
      <Typography variant="pageTitle" as="h2">
        角色
      </Typography>,
    );
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('variant、tone、strong 以 data-* 屬性表達，不寫死顏色', () => {
    render(
      <Typography tone="danger" strong data-testid="text">
        錯誤
      </Typography>,
    );
    const text = screen.getByTestId('text');
    expect(text).toHaveAttribute('data-variant', 'body');
    expect(text).toHaveAttribute('data-tone', 'danger');
    expect(text).toHaveAttribute('data-strong');
  });

  it('透傳 className 與 data-testid', () => {
    render(
      <Typography className="mt-2" data-testid="text">
        內容
      </Typography>,
    );
    expect(screen.getByTestId('text')).toHaveClass('mt-2');
  });
});

describe('Title', () => {
  it.each([
    [1, 'pageTitle'],
    [2, 'sectionTitle'],
    [3, 'bodyStrong'],
  ] as const)('level %i 渲染成 h%i，外觀是 %s', (level, variant) => {
    render(<Title level={level}>標題</Title>);
    const heading = screen.getByRole('heading', { level, name: '標題' });
    expect(heading).toHaveAttribute('data-variant', variant);
  });

  it('as 可以只換標籤、保留外觀', () => {
    render(
      <Title level={1} as="h2">
        標題
      </Title>,
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('data-variant', 'pageTitle');
  });
});

describe('Text', () => {
  it('預設渲染成行內 span', () => {
    render(<Text data-testid="text">內容</Text>);
    expect(screen.getByTestId('text').tagName).toBe('SPAN');
  });

  it.each([
    [{}, 'body'],
    [{ size: 'sm' }, 'caption'],
    [{ code: true }, 'code'],
    [{ code: true, size: 'sm' }, 'code'],
  ] as const)('%o → variant %s', (props, variant) => {
    render(
      <Text data-testid="text" {...props}>
        內容
      </Text>,
    );
    expect(screen.getByTestId('text')).toHaveAttribute('data-variant', variant);
  });
});

describe('Paragraph', () => {
  it('預設渲染成 p，size="sm" 用 caption 外觀', () => {
    render(
      <Paragraph size="sm" data-testid="text">
        說明
      </Paragraph>,
    );
    const text = screen.getByTestId('text');
    expect(text.tagName).toBe('P');
    expect(text).toHaveAttribute('data-variant', 'caption');
  });
});

describe('copyable', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('沒開 copyable 時不渲染複製按鈕', () => {
    render(<Text>abc</Text>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('點擊後把 children 的純文字寫入剪貼簿，並切換成「已複製」', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(
      <Paragraph copyable={{ onCopy }}>
        編號 <strong>A-001</strong>
      </Paragraph>,
    );

    await user.click(screen.getByRole('button', { name: '複製' }));

    expect(await navigator.clipboard.readText()).toBe('編號 A-001');
    expect(onCopy).toHaveBeenCalledWith('編號 A-001');
    const button = screen.getByRole('button', { name: '已複製' });
    expect(button).toHaveAttribute('data-copied');
  });

  it('copyable.text 指定時複製它而不是畫面文字', async () => {
    const user = userEvent.setup();
    render(<Text copyable={{ text: 'secret-token' }}>••••</Text>);

    await user.click(screen.getByRole('button', { name: '複製' }));

    expect(await navigator.clipboard.readText()).toBe('secret-token');
  });

  it('resetAfter 之後回到「複製」', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Text copyable={{ resetAfter: 1000 }}>abc</Text>);

    await user.click(screen.getByRole('button', { name: '複製' }));
    // 寫入剪貼簿是非同步的，切換成「已複製」要等它完成
    expect(await screen.findByRole('button', { name: '已複製' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('button', { name: '複製' })).not.toHaveAttribute('data-copied');
  });

  it('寫入剪貼簿失敗時呼叫 onError，不切換成「已複製」', async () => {
    const user = userEvent.setup();
    const error = new Error('denied');
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(error);
    const onError = vi.fn();
    const onCopy = vi.fn();
    render(<Text copyable={{ onError, onCopy }}>abc</Text>);

    await user.click(screen.getByRole('button', { name: '複製' }));

    expect(onError).toHaveBeenCalledWith(error);
    expect(onCopy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '複製' })).not.toHaveAttribute('data-copied');
  });

  it('文案可覆寫（features/ 以 t() 傳入）', () => {
    render(
      <Title copyable={{ copyLabel: 'Copy', copiedLabel: 'Copied' }} level={2}>
        abc
      </Title>,
    );
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('複製按鈕的 className / data-testid 可經由 classNames / testIds 覆寫', () => {
    render(
      <Text copyable classNames={{ copy: 'ml-2' }} testIds={{ copy: 'id-copy' }}>
        abc
      </Text>,
    );
    expect(screen.getByTestId('id-copy')).toHaveClass('ml-2');
  });

  it('鍵盤可以聚焦並觸發複製', async () => {
    const user = userEvent.setup();
    render(<Text copyable>abc</Text>);

    await user.tab();
    await user.keyboard('{Enter}');

    expect(await navigator.clipboard.readText()).toBe('abc');
  });
});

describe('getNodeText', () => {
  it.each([
    ['字串', 'abc', 'abc'],
    ['數字', 42, '42'],
    ['陣列', ['a', 1, null, false, 'b'], 'a1b'],
    [
      '巢狀元素',
      <span key="x">
        a<b>b</b>c
      </span>,
      'abc',
    ],
    ['空值', null, ''],
  ])('%s', (_label, node, expected) => {
    expect(getNodeText(node)).toBe(expected);
  });
});

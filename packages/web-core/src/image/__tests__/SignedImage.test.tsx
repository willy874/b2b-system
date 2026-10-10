import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { coalesce } from '../coalesce';
import { SignedAvatar } from '../SignedAvatar';
import { SignedImage } from '../SignedImage';
import type { ImageSources } from '../types';

function sourcesOf(signature: string, expiresAt = '2026-10-09T12:00:00.000Z'): ImageSources {
  return {
    width: 800,
    height: 600,
    expiresAt,
    variants: {
      sm: {
        src: `https://files.test/sm.jpg?sig=${signature}`,
        srcSet: `https://files.test/sm.jpg?sig=${signature} 1x, https://files.test/sm@2x.jpg?sig=${signature} 2x`,
        sources: [
          {
            type: 'image/webp',
            srcSet: `https://files.test/sm.webp?sig=${signature} 1x`,
          },
        ],
        width: 32,
        height: 24,
      },
    },
  };
}

const FALLBACK = <span data-testid="fallback">AC</span>;

describe('SignedImage（docs/architecture/backend/25-image.md §5）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('渲染 <picture>：其他格式在 <source>，主格式在 <img>，帶寬高、lazy 與 async 解碼', () => {
    render(<SignedImage sources={sourcesOf('a')} variant="sm" alt="Alice" data-testid="pic" />);
    const picture = screen.getByTestId('pic');
    expect(picture.tagName).toBe('PICTURE');
    const source = picture.querySelector('source');
    expect(source).toHaveAttribute('type', 'image/webp');
    expect(source).toHaveAttribute('srcset', 'https://files.test/sm.webp?sig=a 1x');
    const img = screen.getByRole('img', { name: 'Alice' });
    expect(img).toHaveAttribute('src', 'https://files.test/sm.jpg?sig=a');
    expect(img).toHaveAttribute(
      'srcset',
      'https://files.test/sm.jpg?sig=a 1x, https://files.test/sm@2x.jpg?sig=a 2x',
    );
    expect(img).toHaveAttribute('width', '32');
    expect(img).toHaveAttribute('height', '24');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
  });

  it('沒有圖片（null）或沒有那個版本：顯示退路', () => {
    const { rerender } = render(
      <SignedImage sources={null} variant="sm" alt="Alice" fallback={FALLBACK} />,
    );
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    rerender(<SignedImage sources={sourcesOf('a')} variant="xl" alt="Alice" fallback={FALLBACK} />);
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('載入失敗：呼叫 onExpired 一次；重抓之後換成新網址就重試', () => {
    const onExpired = vi.fn();
    const { rerender } = render(
      <SignedImage sources={sourcesOf('old')} variant="sm" alt="Alice" onExpired={onExpired} />,
    );
    fireEvent.error(screen.getByRole('img'));
    expect(onExpired).toHaveBeenCalledOnce();
    // 同一個網址再失敗一次（例：另一個 <source> 也失敗）不會再呼叫
    rerender(
      <SignedImage sources={sourcesOf('new')} variant="sm" alt="Alice" onExpired={onExpired} />,
    );
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://files.test/sm.jpg?sig=new');
  });

  it('重抓之後仍失敗：顯示退路，不再呼叫 onExpired', () => {
    const onExpired = vi.fn();
    const { rerender } = render(
      <SignedImage
        sources={sourcesOf('old')}
        variant="sm"
        alt="Alice"
        onExpired={onExpired}
        fallback={FALLBACK}
      />,
    );
    fireEvent.error(screen.getByRole('img'));
    rerender(
      <SignedImage
        sources={sourcesOf('new')}
        variant="sm"
        alt="Alice"
        onExpired={onExpired}
        fallback={FALLBACK}
      />,
    );
    fireEvent.error(screen.getByRole('img'));
    expect(onExpired).toHaveBeenCalledOnce();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('重抓後載入成功：之後再過期可以再重抓一次', () => {
    const onExpired = vi.fn();
    const { rerender } = render(
      <SignedImage sources={sourcesOf('a')} variant="sm" alt="Alice" onExpired={onExpired} />,
    );
    fireEvent.error(screen.getByRole('img'));
    rerender(
      <SignedImage sources={sourcesOf('b')} variant="sm" alt="Alice" onExpired={onExpired} />,
    );
    fireEvent.load(screen.getByRole('img'));
    rerender(
      <SignedImage sources={sourcesOf('c')} variant="sm" alt="Alice" onExpired={onExpired} />,
    );
    fireEvent.error(screen.getByRole('img'));
    expect(onExpired).toHaveBeenCalledTimes(2);
  });

  it('沒給 onExpired：第一次失敗就顯示退路', () => {
    render(<SignedImage sources={sourcesOf('a')} variant="sm" alt="Alice" fallback={FALLBACK} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('isLongLived：在到期前 60 秒主動呼叫 onExpired；一般的頁面不主動重抓', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T11:50:00.000Z'));
    const onExpired = vi.fn();
    const { unmount } = render(
      <SignedImage sources={sourcesOf('a')} variant="sm" alt="Alice" onExpired={onExpired} />,
    );
    act(() => {
      vi.advanceTimersByTime(20 * 60_000);
    });
    expect(onExpired).not.toHaveBeenCalled();
    unmount();

    vi.setSystemTime(new Date('2026-10-09T11:50:00.000Z'));
    render(
      <SignedImage
        sources={sourcesOf('a')}
        variant="sm"
        alt="Alice"
        onExpired={onExpired}
        isLongLived
      />,
    );
    act(() => {
      vi.advanceTimersByTime(9 * 60_000 - 1);
    });
    expect(onExpired).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onExpired).toHaveBeenCalledOnce();
  });

  it('isLongLived：到期時間遠到超過 setTimeout 的上限時不排程（不會被當成 1ms 立刻重抓）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T11:50:00.000Z'));
    const onExpired = vi.fn();
    render(
      <SignedImage
        sources={sourcesOf('a', '2099-01-01T00:00:00.000Z')}
        variant="sm"
        alt="Alice"
        onExpired={onExpired}
        isLongLived
      />,
    );
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe('coalesce', () => {
  it('同一個微任務內的多次呼叫只執行一次；之後的呼叫會再執行', async () => {
    const fn = vi.fn();
    const onExpired = coalesce(fn);
    for (let i = 0; i < 50; i += 1) onExpired();
    expect(fn).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledOnce();
    onExpired();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('SignedAvatar', () => {
  it('有頭像：圖片疊在名字縮寫上；縮寫仍是退路', () => {
    render(
      <SignedAvatar name="Alice Chen" sources={sourcesOf('a')} variant="sm" data-testid="avatar" />,
    );
    expect(screen.getByRole('img', { name: 'Alice Chen' })).toHaveAttribute(
      'src',
      'https://files.test/sm.jpg?sig=a',
    );
    expect(screen.getByTestId('avatar')).toHaveTextContent('AC');
  });

  it('沒有頭像：只有縮寫', () => {
    render(<SignedAvatar name="Alice Chen" sources={null} variant="sm" data-testid="avatar" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('avatar')).toHaveTextContent('AC');
  });
});

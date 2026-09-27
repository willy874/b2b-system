import { Component } from 'react';
import type { ReactNode } from 'react';

interface PreviewBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

/**
 * 預覽解析器是擴充點（可能是第三方寫的）：它壞掉時只換成「無法預覽」，不讓整個 LightBox 或頁面掛掉。
 * 換檔案時由呼叫端以 `key` 重建，錯誤狀態不會延續到下一個檔案。
 */
export class PreviewBoundary extends Component<PreviewBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

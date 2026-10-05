import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// 頁面整合測試會經過 lazy 載入（第一次 import 頁面模組），全套平行跑時 1 秒的預設等待不夠
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

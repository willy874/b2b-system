import { beforeEach, describe, expect, it } from 'vitest';

import {
  getHeaderTools,
  registerHeaderTool,
  resetHeaderToolRegistry,
  resolveHeaderTools,
} from '../registry';
import type { HeaderTool } from '../registry';

function tool(key: string, order: number): HeaderTool {
  return { key, order, labelI18nKey: key, icon: 'settings', Component: () => null };
}

const keysOf = (items: ReturnType<typeof resolveHeaderTools>) =>
  items.map(({ tool: item, visible }) => `${item.key}${visible ? '' : '(hidden)'}`);

describe('頂列工具的註冊表', () => {
  beforeEach(() => resetHeaderToolRegistry());

  it('依 order 列出，與登記的先後無關', () => {
    registerHeaderTool(tool('theme', 200));
    registerHeaderTool(tool('language', 100));
    expect(getHeaderTools().map((item) => item.key)).toEqual(['language', 'theme']);
  });

  it('同一個 key 登記兩次會拋錯', () => {
    registerHeaderTool(tool('theme', 200));
    expect(() => registerHeaderTool(tool('theme', 300))).toThrow('theme');
  });
});

describe('resolveHeaderTools', () => {
  const registered = [tool('language', 100), tool('theme', 200), tool('help', 300)];

  it('沒有設定時照預設順序全部顯示', () => {
    expect(keysOf(resolveHeaderTools(registered, null))).toEqual(['language', 'theme', 'help']);
  });

  it('套用設定的順序與隱藏項', () => {
    const settings = { order: ['help', 'theme', 'language'], hidden: ['theme'] };
    expect(keysOf(resolveHeaderTools(registered, settings))).toEqual([
      'help',
      'theme(hidden)',
      'language',
    ]);
  });

  it('之後追加的工具接在後面、預設顯示；已經不存在的工具略過', () => {
    const settings = { order: ['theme', 'removed', 'language'], hidden: ['removed'] };
    expect(keysOf(resolveHeaderTools(registered, settings))).toEqual(['theme', 'language', 'help']);
  });
});

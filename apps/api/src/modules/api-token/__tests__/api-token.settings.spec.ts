import { describe, expect, it } from 'vitest';

import { resolveSetting } from '@/core/settings';
import type { EnvReader } from '@/core/settings';

import { API_TOKEN_MAX_LIFETIME_DAYS } from '../api-token.constants';
import {
  PERSONAL_TOKEN_MAX_DAYS_SETTING,
  SERVICE_ACCOUNT_TOKEN_MAX_DAYS_SETTING,
} from '../api-token.settings';

const env = (() => undefined) as unknown as EnvReader;

describe.each([
  ['個人 token', PERSONAL_TOKEN_MAX_DAYS_SETTING, API_TOKEN_MAX_LIFETIME_DAYS.human],
  ['服務帳號 token', SERVICE_ACCOUNT_TOKEN_MAX_DAYS_SETTING, API_TOKEN_MAX_LIFETIME_DAYS.service],
] as const)(
  '%s的到期上限設定（docs/architecture/06-external-api.md §9.2 D8）',
  (_label, definition, platformMax) => {
    const { schema, defaultValue, isPublic } = resolveSetting(definition, env);

    it('預設值是平台上限', () => {
      expect(defaultValue).toBe(platformMax);
    });

    it('可以調短到 1 天', () => {
      expect(schema.safeParse(1).success).toBe(true);
    });

    it('不能超過平台上限（租戶只能調短）', () => {
      expect(schema.safeParse(platformMax).success).toBe(true);
      expect(schema.safeParse(platformMax + 1).success).toBe(false);
    });

    it('不能是 0 或負數（沒有不過期的 token）', () => {
      expect(schema.safeParse(0).success).toBe(false);
      expect(schema.safeParse(-1).success).toBe(false);
    });

    it('只能是整數天', () => {
      expect(schema.safeParse(1.5).success).toBe(false);
    });

    it('不公開給未登入的前端', () => {
      expect(isPublic).toBe(false);
    });
  },
);

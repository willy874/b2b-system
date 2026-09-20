import { defineConfig } from 'orval';

/**
 * 後端是唯一事實來源（ADR-0007）。
 * `apps/api/openapi.json` 進版控，因此不需要跑起 server 也能重新產生 SDK。
 */
export default defineConfig({
  api: {
    input: {
      target: '../../apps/api/openapi.json',
    },
    output: {
      mode: 'tags-split',
      target: './src/generated/endpoints.ts',
      schemas: './src/generated/model',
      client: 'fetch',
      baseUrl: '',
      clean: true,
      override: {
        mutator: {
          path: './src/http-client.ts',
          name: 'sdkFetch',
        },
      },
    },
  },
});

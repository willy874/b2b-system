export const ENV = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  ENABLE_MOCK: import.meta.env.VITE_ENABLE_MOCK === 'true',
  MODE: import.meta.env.MODE,
} as const;

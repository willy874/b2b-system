import { inject } from 'vitest';

// 每個測試檔建立 AppModule 之前都要有平台 DB 與解開租戶連線字串的金鑰（test/global-setup.ts）
process.env.PLATFORM_DATABASE_URL = inject('platformDatabaseUrl');
process.env.TENANT_SECRET_KEY = inject('tenantSecretKey');

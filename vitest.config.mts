import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/openwa*.spec.ts', '**/whatsapp*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['apps/api/src/**/*.ts', 'apps/web/app/api-client.ts'],
      exclude: ['**/*.spec.ts', 'apps/api/src/main.ts', 'apps/api/src/app.module.ts', 'apps/api/src/automation.service.ts', 'apps/api/src/openwa*.ts', 'apps/api/src/whatsapp.controller.ts'],
      thresholds: { lines: 80, statements: 75, functions: 75, branches: 60 },
    },
  },
});

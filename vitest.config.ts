import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tools/submodules/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      exclude: ['tools/submodules/**', 'node_modules/**', 'dist/**', 'tests/**'],
      thresholds: {
        lines: 50,
        branches: 45,
        functions: 50,
        statements: 50
      }
    }
  }
});

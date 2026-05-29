import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tools/submodules/**', 'node_modules/**', 'dist/**']
  }
});

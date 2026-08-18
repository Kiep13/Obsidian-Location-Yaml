import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test-setup.ts'],
    exclude: ['node_modules', 'dist', 'build', '.git'],
    reporters: ['default'],
    pool: 'threads',
  },
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, './obsidian.ts'),
    },
  },
});

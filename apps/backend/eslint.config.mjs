import base from '@getmunin/eslint-config';

export default [
  ...base,
  {
    ignores: ['scripts/**/*.mjs', 'eslint.config.mjs', 'vitest.config.ts'],
  },
];

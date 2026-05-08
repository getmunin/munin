import base from './index.mjs';
import globals from 'globals';

export default [
  ...base,
  {
    ignores: ['next-env.d.ts', 'next.config.*', 'postcss.config.*', 'eslint.config.*'],
  },
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
];

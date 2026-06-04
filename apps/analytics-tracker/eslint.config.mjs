import base from '@getmunin/eslint-config';

export default [
  ...base,
  {
    ignores: ['eslint.config.mjs'],
  },
];

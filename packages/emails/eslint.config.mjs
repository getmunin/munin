import config from '@getmunin/eslint-config';
import tseslint from 'typescript-eslint';

export default [
  ...config,
  {
    files: ['eslint.config.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
];

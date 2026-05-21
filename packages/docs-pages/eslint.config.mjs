import tseslint from 'typescript-eslint';
import shared from '@getmunin/eslint-config';

export default [
  ...shared,
  {
    files: ['eslint.config.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
];

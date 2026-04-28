import base from './index.mjs';
import globals from 'globals';

/** ESLint config for the Next.js web app. Extends base with browser globals + JSX support. */
export default [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
];

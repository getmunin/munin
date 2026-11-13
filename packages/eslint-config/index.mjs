import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const TS_EXTENSION = String.raw`/\.[cm]?tsx?$/`;
const RELATIVE_TS_PATH = String.raw`/^\..*\.[cm]?tsx?$/`;
const DYNAMIC_TS_IMPORT_MESSAGE =
  'tsc leaves the .ts extension of a dynamic import in place inside a decorated class, so the built dist cannot load it. Import the module statically.';

const dynamicTsImportRestrictions = [
  `ImportExpression > Literal.source[value=${RELATIVE_TS_PATH}]`,
  `ImportExpression > TemplateLiteral.source > TemplateElement[tail=true][value.raw=${TS_EXTENSION}]`,
  `ImportExpression > BinaryExpression.source > Literal.right[value=${TS_EXTENSION}]`,
].map((selector) => ({ selector, message: DYNAMIC_TS_IMPORT_MESSAGE }));

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/.next/**', '**/.turbo/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs'],
        },
      },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      'no-restricted-syntax': ['error', ...dynamicTsImportRestrictions],
    },
  },
  {
    files: ['**/*.test.{ts,tsx,mts}', '**/*.spec.{ts,tsx,mts}', '**/test/**/*.{ts,tsx,mts}'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  prettier,
);

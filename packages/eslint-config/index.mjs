import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const DYNAMIC_TS_IMPORT_IN_DECORATED_CLASS =
  'tsc does not rewrite .ts → .js for import() inside a class that uses decorators, so dist ships a broken path. Use a static import, or move the import() out of the class.';

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
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ClassDeclaration:has(Decorator) ImportExpression[source.value=/^\\..*\\.[cm]?tsx?$/]',
          message: DYNAMIC_TS_IMPORT_IN_DECORATED_CLASS,
        },
        {
          selector:
            'ClassDeclaration:has(Decorator) ImportExpression > TemplateLiteral:has(TemplateElement[tail=true][value.raw=/\\.[cm]?tsx?$/])',
          message: DYNAMIC_TS_IMPORT_IN_DECORATED_CLASS,
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx,mts}', '**/*.spec.{ts,tsx,mts}', '**/test/**/*.{ts,tsx,mts}'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
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

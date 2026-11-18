import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'examples/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The core is framework-agnostic by contract: React must never be
    // imported below src/core. This rule is the enforcement of that claim.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'src/core is framework-agnostic. React belongs in src/react.' },
            { name: 'react-dom', message: 'src/core is framework-agnostic. React belongs in src/react.' },
          ],
          patterns: ['react/*', 'react-dom/*', '../react/*', '../../react/*'],
        },
      ],
    },
  },
);

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const oneLetterVariablePattern = '^[A-Za-z]$';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/build/**', '**/dist/**', '**/coverage/**', '**/.obsidian/**', '**/main.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      'no-console': 'off',
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],
      'id-length': [
        'error',
        {
          min: 2,
          exceptions: [],
          properties: 'never',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: `Identifier[name=/${oneLetterVariablePattern}/]`,
          message: 'One-letter identifiers are forbidden. Use a descriptive name.',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    languageOptions: {
      globals: {
        beforeEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        vi: 'readonly',
        console: 'readonly',
      },
    },
  },
);

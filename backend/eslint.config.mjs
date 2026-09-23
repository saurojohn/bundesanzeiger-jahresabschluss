// ============================================================================
// Bundesanzeiger Jahresabschluss — Backend ESLint Flat Config
// ============================================================================
// Mandant-Trennung: direkter Prisma-Zugriff (findUnique, findFirst, findMany,
// delete, update, create, upsert, ...) ist in `src/modules/**/*.ts` verboten
// — erzwungen wird der Pfad über dedizierte *Repository.ts-Dateien, die
// einen mandantId-Filter garantieren.
// ============================================================================

import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

const PRISMA_DIRECT_OPERATION = /^(findUnique|findFirst|findMany|update|updateMany|delete|deleteMany|create|createMany|upsert|count|aggregate|groupBy)$/;

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'prisma/migrations/**',
      'prisma/seed.ts',
      'src/generated/**',
      'src/prisma/**/*.ts',
      'e2e/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      'no-redeclare': 'off',
      'no-dupe-class-members': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // Mandant-Trennung — gilt ausschließlich für Module.
  {
    files: ['src/modules/**/*.ts'],
    ignores: ['src/modules/**/*Repository*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `MemberExpression[object.name='prisma'][property.name=/${PRISMA_DIRECT_OPERATION.source}/]`,
          message:
            'Direkter Prisma-Aufruf in modules/ ist verboten. Lagere ihn in eine *Repository.ts-Datei aus, die einen mandantId-Filter erzwingt.',
        },
        {
          selector: `CallExpression[callee.object.name='prisma'][callee.property.name=/${PRISMA_DIRECT_OPERATION.source}/]`,
          message:
            'Direkter Prisma-Aufruf in modules/ ist verboten. Lagere ihn in eine *Repository.ts-Datei aus, die einen mandantId-Filter erzwingt.',
        },
      ],
    },
  },
];

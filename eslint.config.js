import tseslint from 'typescript-eslint';
export default tseslint.config(
  {
    ignores: [
      'build/**',
      '.svelte-kit/**',
      'node_modules/**',
      'data/**',
      'playwright-report/**',
      'test-results/**',
      '.e2e-data/**',
    ],
  },
  ...tseslint.configs.recommended,
  { files: ['**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
);

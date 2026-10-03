import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-analytics/**', 'deploy/.build/**', 'deploy/.test-dist/**', 'e2e/contracts/**', 'test-results/**', 'playwright-report/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      // Secrets must never be logged.
      'no-console': 'error',
      // XSS sinks are banned (Trusted Types also blocks them at runtime).
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'dangerouslySetInnerHTML is forbidden' },
        { selector: "MemberExpression[property.name=/^(innerHTML|outerHTML)$/]", message: 'innerHTML/outerHTML is forbidden' },
        { selector: "CallExpression[callee.name='eval']", message: 'eval is forbidden' },
      ],
      // Nothing is persisted in the browser.
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'No browser storage: secrets live in memory only' },
        { name: 'sessionStorage', message: 'No browser storage: secrets live in memory only' },
        { name: 'indexedDB', message: 'No browser storage: secrets live in memory only' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['test/**', 'test-int/**', 'e2e/**', 'deploy/test/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-unused-vars': 'off' },
  },
);

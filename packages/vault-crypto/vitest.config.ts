import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
    // Inline the Shamir package so tests can substitute its CSPRNG module
    // (`shamir-secret-sharing/csprng`) with the vectors' replay stream.
    server: { deps: { inline: ['shamir-secret-sharing'] } },
    // README doctest: snippets extracted by scripts/extract-readme-snippets.mjs.
    typecheck: { include: ['test/readme/*.test-d.ts'], tsconfig: './tsconfig.json' },
  },
});

// @ts-check
//
// Module boundaries for the SPA:
//   shared   imports only shared (and plain models and environment settings)
//   core     imports core and shared, never a feature
//   features import core and shared, their own files, and another module only through its public index.ts
//   main.ts and app.* are the composition root and may import anything
// Only the boundary rules are on. Angular's recommended rule set is a separate decision.
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const boundaries = require('eslint-plugin-boundaries');

/** Who may import whom. Anything not allowed here is a violation (default: disallow). */
const dependencies = {
  default: 'disallow',
  message: '{{ from.element.type }} may not import {{ to.element.type }} ({{ to.element.path }})',
  policies: [
    // The composition root (in no element) may import anything.
    { from: { element: { isUnknown: true } }, allow: { to: { element: { type: ['core', 'shared', 'models', 'feature', 'environment', 'testing'] } } } },
    { from: { element: { type: 'core' } }, allow: { to: { element: { type: ['core', 'shared', 'models', 'environment'] } } } },
    { from: { element: { type: 'shared' } }, allow: { to: { element: { type: ['shared', 'models', 'environment'] } } } },
    { from: { element: { type: 'models' } }, allow: { to: { element: { type: 'models' } } } },
    { from: { element: { type: 'environment' } }, allow: { to: { element: { type: 'environment' } } } },
    // The shared test helpers stub core services.
    { from: { element: { type: 'testing' } }, allow: { to: { element: { type: ['core', 'shared', 'models', 'environment'] } } } },
    { from: { element: { type: 'feature' } }, allow: { to: { element: { type: ['core', 'shared', 'models', 'environment'] } } } },
    // Another module only through its public API. Its own files are internal and never checked.
    {
      from: { element: { type: 'feature' } },
      allow: { to: { element: { type: 'feature', fileInternalPath: 'index.ts' } } },
    },
    // Tests may also use the shared test helpers.
    { from: { file: { categories: 'test' } }, allow: { to: { element: { type: 'testing' } } } },
  ],
};

module.exports = defineConfig(
  {
    ignores: ['dist/**', '.angular/**', 'coverage/**', 'node_modules/**', 'tests/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { boundaries },
    settings: {
      // Resolves the @core/*, @shared/*, @features/* and @models aliases from tsconfig.json.
      'import/resolver': { typescript: { project: './tsconfig.json' } },
      // Files outside every element (src/main.ts, src/setup-tests.ts and src/app/app.*) are the composition root
      // and aren't checked.
      'boundaries/elements': [
        { type: 'core', pattern: 'src/app/core', partialMatch: false },
        { type: 'core', pattern: 'src/app/guards', partialMatch: false },
        { type: 'shared', pattern: 'src/app/shared', partialMatch: false },
        { type: 'models', pattern: 'src/app/models', partialMatch: false },
        { type: 'feature', pattern: 'src/app/features/*', capture: ['module'], partialMatch: false },
        { type: 'environment', pattern: 'src/environments', partialMatch: false },
        { type: 'testing', pattern: 'src/testing', partialMatch: false },
      ],
      'boundaries/files': [{ category: 'test', pattern: '**/*.spec.ts' }],
    },
    rules: {
      'boundaries/dependencies': ['error', dependencies],
    },
  },
  // Known violations, warnings until they are fixed: shared components that inject core state (the header, the
  // trade-unit selector, the help panel and the toast container), features importing each other directly, and
  // ApiService typing recap groups with the daily digest's models.
  {
    files: ['src/app/shared/**/*.ts', 'src/app/features/**/*.ts', 'src/app/core/services/api.service.ts'],
    rules: {
      'boundaries/dependencies': ['warn', dependencies],
    },
  },
);
